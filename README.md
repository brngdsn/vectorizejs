# VectorizeJS

[![npm version](https://img.shields.io/npm/v/vectorizejs.svg)](https://www.npmjs.com/package/vectorizejs)
[![License](https://img.shields.io/npm/l/vectorizejs.svg)](https://github.com/brngdsn/vectorizejs/blob/main/LICENSE)
[![Node.js CI](https://github.com/brngdsn/vectorizejs/actions/workflows/node.js.yml/badge.svg)](https://github.com/brngdsn/vectorizejs/actions)

**VectorizeJS** is a Node.js module that automates the vectorization of text data stored in a PostgreSQL database. It listens for changes in a specified table, chunks the text content, generates embeddings using a user-defined function, and stores the embeddings back into the database. Designed for scalability and robustness, it includes features like asynchronous processing, error handling with retries, concurrency control, and comprehensive logging.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Usage](#usage)
- [Configuration Options](#configuration-options)
- [Embedding Function](#embedding-function)
- [Logging](#logging)
- [Error Handling and Retries](#error-handling-and-retries)
- [Concurrency Control](#concurrency-control)
- [Graceful Shutdown](#graceful-shutdown)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Automated Vectorization**: Automatically generates embeddings for new or updated text data in your PostgreSQL database.
- **Token-Based Chunking**: Splits large texts into manageable chunks based on token count, respecting model token limits.
- **Asynchronous Processing**: Processes chunks concurrently with configurable concurrency limits for optimal performance.
- **Error Handling and Retries**: Robust error handling with an exponential backoff retry mechanism for transient errors.
- **Comprehensive Logging**: Detailed logs using the `winston` library, aiding in monitoring and debugging.
- **Resource Management**: Concurrency control using `p-limit` to prevent resource exhaustion.
- **Graceful Shutdown**: Handles process termination signals to close database connections properly.

## Installation

Install VectorizeJS and its peer dependencies using npm:

```bash
npm install vectorizejs
```

Install the required peer dependencies:

```bash
npm install pg gpt-3-encoder winston p-limit
```

## Requirements

- **Node.js**: Version 12 or higher.
- **PostgreSQL**: Version 12 or higher with the `pgvector` extension installed.
- **Database**: A PostgreSQL database with appropriate tables set up.

## Usage

### 1. Import the Module

```javascript
const vectorize = require('vectorizejs');
```

### 2. Define Your Embedding Function

Implement an asynchronous function that generates embeddings from text. This function can call external APIs like OpenAI's embedding API.

```javascript
const axios = require('axios');

async function embeddingFunction(text) {
  try {
    const response = await axios.post('https://api.example.com/embed', { text });
    return response.data.embedding; // Should be a vector/array of numbers
  } catch (error) {
    throw error;
  }
}
```

### 3. Configure and Run VectorizeJS

```javascript
vectorize({
  connectionString: 'your_postgresql_connection_string',
  sourceTable: 'your_source_table',
  contentColumn: 'your_content_column',
  embeddingTable: 'your_embedding_table',
  embeddingDimensions: 1536, // Adjust based on your embedding model
  embeddingFunction: embeddingFunction,
  chunkSize: 800,            // Optional, default is 800 tokens
  chunkOverlap: 200,         // Optional, default is 200 tokens
  maxConcurrentChunks: 5,    // Optional, default is 5
  maxRetries: 3,             // Optional, default is 3
});
```

## Configuration Options

- **connectionString** (`string`, required): PostgreSQL connection string.

- **sourceTable** (`string`, required): Name of the source table to monitor for changes.

- **contentColumn** (`string`, required): Column in the source table that contains the text content.

- **embeddingTable** (`string`, required): Name of the table where embeddings will be stored.

- **embeddingDimensions** (`number`, required): Dimensionality of the embeddings produced by your embedding function.

- **embeddingFunction** (`function`, required): Asynchronous function that takes a string and returns an embedding vector.

- **chunkSize** (`number`, optional): Maximum number of tokens per chunk. Default is `800`.

- **chunkOverlap** (`number`, optional): Number of tokens to overlap between chunks. Default is `200`.

- **maxConcurrentChunks** (`number`, optional): Maximum number of chunks to process concurrently. Default is `5`.

- **maxRetries** (`number`, optional): Maximum number of retries for transient errors during embedding generation. Default is `3`.

## Embedding Function

Your `embeddingFunction` should be an asynchronous function that accepts a text string and returns a Promise resolving to an embedding vector (an array of numbers). Here's an example using OpenAI's API:

```javascript
const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: 'your_openai_api_key',
});

const openai = new OpenAIApi(configuration);

async function embeddingFunction(text) {
  try {
    const response = await openai.createEmbedding({
      input: text,
      model: 'text-embedding-ada-002',
    });
    return response.data.data[0].embedding;
  } catch (error) {
    throw error;
  }
}
```

**Note**: Ensure that your embedding function handles errors appropriately by throwing exceptions, which the retry mechanism will catch.

## Logging

VectorizeJS uses the `winston` library for logging. By default, it logs to the console with timestamps and log levels. You can customize the logging behavior by modifying the logger configuration in the source code.

```javascript
const logger = winston.createLogger({
  level: 'info', // Change to 'debug' for more verbose output
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});
```

## Error Handling and Retries

VectorizeJS includes robust error handling:

- **Retry Mechanism**: Transient errors during the embedding process trigger retries with exponential backoff.

- **Maximum Retries**: Configurable via the `maxRetries` option. Default is `3`.

- **Logging Errors**: All errors are logged with detailed messages to aid in debugging.

## Concurrency Control

To prevent resource exhaustion, VectorizeJS limits the number of concurrent chunk processing operations:

- **Concurrency Limit**: Configurable via the `maxConcurrentChunks` option. Default is `5`.

- **Adjusting the Limit**: Increase or decrease based on your system's capacity and the embedding service's rate limits.

## Graceful Shutdown

VectorizeJS handles process termination signals to ensure a graceful shutdown:

```javascript
process.on('SIGINT', async () => {
  logger.info('Shutting down VectorizeJS...');
  await client.end();
  process.exit();
});
```

This ensures that database connections are closed properly, preventing potential data corruption or connection leaks.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/YourFeature`).
3. Commit your changes (`git commit -am 'Add some feature'`).
4. Push to the branch (`git push origin feature/YourFeature`).
5. Open a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Disclaimer**: Ensure that you comply with the terms and conditions of any third-party services (like OpenAI) that you use with this module. Handle API keys and sensitive information securely.