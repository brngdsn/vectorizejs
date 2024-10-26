// __tests__/vectorize.test.js

const winston = require('winston');
const pLimit = require('p-limit');
const { encode, decode } = require('gpt-3-encoder');
const { Client } = require('pg');

// Mock the logger to prevent actual logging during tests
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock the pg Client
jest.mock('pg', () => {
  const mClient = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };
  return { Client: jest.fn(() => mClient) };
});

// Import the module under test
const { vectorize, chunkText, retry } = require('../vectorize');

// Mock the embedding function
const mockEmbeddingFunction = jest.fn(async (text) => {
  return Array(1536).fill(0.1); // Dummy embedding vector
});

describe('VectorizeJS Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('chunkText splits text into correct chunks', () => {
    const text = 'This is a sample text to test the chunking function.';
    const maxTokens = 5;
    const overlap = 2;

    const chunks = chunkText(text, maxTokens, overlap);

    // Tokenizing the sample text
    const tokens = encode(text);
    const expectedChunks = [];
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + maxTokens, tokens.length);
      const chunkTokens = tokens.slice(start, end);
      expectedChunks.push(decode(chunkTokens));
      start += maxTokens - overlap;
    }

    expect(chunks).toEqual(expectedChunks);
  });

  test('retry function retries specified number of times on failure', async () => {
    const failingFunction = jest.fn(() => {
      throw new Error('Transient error');
    });

    await expect(retry(failingFunction, 3)).rejects.toThrow(
      'Failed after 3 retries.'
    );

    expect(failingFunction).toHaveBeenCalledTimes(3);
  });

  test('retry function succeeds if function eventually succeeds', async () => {
    let attempt = 0;
    const transientFunction = jest.fn(() => {
      attempt++;
      if (attempt < 2) {
        throw new Error('Transient error');
      } else {
        return 'Success';
      }
    });

    const result = await retry(transientFunction, 3);
    expect(result).toBe('Success');
    expect(transientFunction).toHaveBeenCalledTimes(2);
  });

  test('vectorize sets up database listeners and processes notifications', async () => {
    const config = {
      connectionString: 'postgres://user:password@localhost:5432/testdb',
      sourceTable: 'source_table',
      contentColumn: 'content',
      embeddingTable: 'embedding_table',
      embeddingDimensions: 1536,
      embeddingFunction: mockEmbeddingFunction,
      chunkSize: 800,
      chunkOverlap: 200,
      maxConcurrentChunks: 2,
      maxRetries: 2,
    };

    await vectorize(config);

    const mockClientInstance = require('pg').Client.mock.instances[0];
    const mockQuery = mockClientInstance.query;

    expect(mockClientInstance.connect).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith('LISTEN data_change');

    // Simulate notification
    const notificationCallback = mockClientInstance.on.mock.calls.find(
      (call) => call[0] === 'notification'
    )[1];

    // Mock database query responses
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT')) {
        return { rows: [{ content: 'Test content for embedding.' }] };
      }
      if (sql.includes('DELETE')) {
        return;
      }
      if (sql.includes('INSERT')) {
        return;
      }
      if (sql.includes('CREATE')) {
        return;
      }
      // Handle other queries as needed
    });

    await notificationCallback({ payload: '1' });

    expect(mockQuery).toHaveBeenCalledWith(
      `SELECT content FROM source_table WHERE id = $1`,
      [1]
    );

    expect(mockEmbeddingFunction).toHaveBeenCalled();
  });

  test('vectorize handles errors during notification processing', async () => {
    const config = {
      connectionString: 'postgres://user:password@localhost:5432/testdb',
      sourceTable: 'source_table',
      contentColumn: 'content',
      embeddingTable: 'embedding_table',
      embeddingDimensions: 1536,
      embeddingFunction: mockEmbeddingFunction,
    };

    await vectorize(config);

    const mockClientInstance = require('pg').Client.mock.instances[0];
    const notificationCallback = mockClientInstance.on.mock.calls.find(
      (call) => call[0] === 'notification'
    )[1];

    // Mock an error during processing
    mockClientInstance.query.mockRejectedValueOnce(
      new Error('Database error')
    );

    await notificationCallback({ payload: '1' });

    const logger = winston.createLogger();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing notification for text_id 1'),
      expect.any(Error)
    );
  });
});
