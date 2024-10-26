console.clear();
import dotenv from 'dotenv'; dotenv.config();
const {
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_PASSWORD,
    POSTGRES_USER,
    POSTGRES_DB    
} = process.env;
import pg from 'pg';
import pgvector from 'pgvector';
const { Client } = pg;
import ollama from 'ollama';
import { vectorize } from '../src/index.js'

async function waitForKeyPress() {
    return new Promise((resolve) => {
      // Ensure the stdin stream is in raw mode to capture individual key presses
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
  
      // Define a handler for the 'data' event
      const onData = (key) => {
        // Clean up: remove the listener and reset the terminal state
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
  
        // Optionally, handle special keys like Ctrl+C
        if (key === '\u0003') { // Ctrl+C
          process.exit();
        }
  
        resolve(key);
      };
  
      // Attach the data event listener
      stdin.on('data', onData);
    });
}

async function embeddingFunction(text) {
  try {
    const embeddingResponse = await ollama.embed({
        model: `nomic-embed-text`,
        input: text
    });
    console.log({embeddingResponse});
    return pgvector.toSql(embeddingResponse.embeddings[0]); // Should be a vector/array of numbers
  } catch (error) {
    throw error;
  }
}

(async function init () {

    // const response = await embeddingFunction(`Hello`);
    // console.log({ response });
    
    const connectionString = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
    console.log({ connectionString });
    
    const client = new Client({ connectionString });
    await client.connect();
  
    // Ensure pgvector extension is available
    await client.query('CREATE table if not exists documents (id serial primary key, content text);');

    await vectorize({
        connectionString,
        sourceTable: 'documents',
        contentColumn: 'content',
        embeddingTable: 'documentembeddings',
        embeddingDimensions: 768, // Adjust based on your embedding model
        embeddingFunction: embeddingFunction,
        chunkSize: 800,            // Optional, default is 800 tokens
        chunkOverlap: 200,         // Optional, default is 200 tokens
        maxConcurrentChunks: 5,    // Optional, default is 5
        maxRetries: 3,             // Optional, default is 3
    });

    const code = `
        async function init () {
            console.log('Hello, Universe!');
        }
    `;

    await waitForKeyPress();

    const newDocument = await client.query('insert into documents (content) values ($1);', [code]);
    console.log({ newDocument });

    await waitForKeyPress();

    const query = `Decribe the provided program.`;
    const queryEmbeddingsSql = await embeddingFunction(query);
    const querySql = `
        SELECT content
        FROM documents
        JOIN documentembeddings ON documents.id = documentembeddings.text_id
        ORDER BY embedding <-> $1
        LIMIT 5;
    `;
    const ragResults = await client.query(querySql, [queryEmbeddingsSql]);

    const context = ragResults.rows.map(r => r.content).join(`\n\n`);
    console.log({ context });

    await waitForKeyPress();

    const question = `
        Summarize the program.
    `;
    const generation = await ollama.generate({
        model: 'llama3.2',
        prompt: `
            ${context}

            Based off the provided context, ${question}.
        `
    });
    console.log({ generatedResponse: generation.response });
})();
