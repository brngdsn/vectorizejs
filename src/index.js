import pg from 'pg';
const { Client } = pg;
import { encode, decode } from 'gpt-3-encoder';
import winston from 'winston';
import pLimit from 'p-limit';

// Configure the logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});

export async function vectorize(config) {
  const {
    connectionString,
    sourceTable,
    contentColumn,
    embeddingTable,
    embeddingDimensions,
    embeddingFunction,
    chunkSize = 800,        // Default chunk size in tokens
    chunkOverlap = 200,     // Default overlap in tokens
    maxConcurrentChunks = 5, // Limit for concurrent chunk processing
    maxRetries = 3,         // Maximum number of retries for transient errors
  } = config;

  const client = new Client({ connectionString });
  await client.connect();

  // Ensure pgvector extension is available
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

  // Set up the embedding table
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${embeddingTable} (
      text_id INTEGER REFERENCES ${sourceTable}(id),
      chunk_index INTEGER,
      embedding VECTOR(${embeddingDimensions}),
      PRIMARY KEY (text_id, chunk_index)
    );
  `);

  // Set up the trigger function and trigger
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_data_change() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('data_change', NEW.id::TEXT);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS data_change_trigger ON ${sourceTable};

    CREATE TRIGGER data_change_trigger
    AFTER INSERT OR UPDATE ON ${sourceTable}
    FOR EACH ROW EXECUTE FUNCTION notify_data_change();
  `);

  // Listen for notifications
  await client.query('LISTEN data_change');

  client.on('notification', async (msg) => {
    try {
      const textId = Number.parseInt(msg.payload, 10);
      logger.info(`Received notification for text_id ${textId}`);

      const res = await client.query(
        `SELECT ${contentColumn} FROM ${sourceTable} WHERE id = $1`,
        [textId]
      );

      if (res.rows.length === 0) {
        logger.warn(`No content found for text_id ${textId}`);
        return;
      }

      const content = res.rows[0]?.[contentColumn];

      // Delete existing embeddings for this text_id
      await client.query(`DELETE FROM ${embeddingTable} WHERE text_id = $1`, [
        textId,
      ]);

      // Chunk the content
      const chunks = chunkText(content, chunkSize, chunkOverlap);
      logger.info(`Processing ${chunks.length} chunks for text_id ${textId}`);

      const limit = pLimit(maxConcurrentChunks);

      // Process each chunk with concurrency limit
      await Promise.all(
        chunks.map((chunk, index) =>
          limit(async () => {
            try {
              const embedding = await retry(
                () => embeddingFunction(chunk),
                maxRetries
              );
              await client.query(
                `INSERT INTO ${embeddingTable} (text_id, chunk_index, embedding) VALUES ($1, $2, $3)`,
                [textId, index, embedding]
              );
              logger.info(
                `Successfully processed chunk ${index} for text_id ${textId}`
              );
            } catch (chunkError) {
              logger.error(
                `Error processing chunk ${index} for text_id ${textId}: ${chunkError.message}`
              );
            }
          })
        )
      );
    } catch (error) {
      logger.error(
        `Error processing notification for text_id ${msg.payload}: ${error.message}`
      );
    }
  });

  logger.info(
    `VectorizeJS is running and listening for changes on table "${sourceTable}".`
  );

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down VectorizeJS...');
    await client.end();
    process.exit();
  });
}

// Helper function to chunk text
export function chunkText(text, maxTokens = 800, overlap = 200) {
  const tokens = encode(text);
  const chunks = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(start + maxTokens, tokens.length);
    const chunkTokens = tokens.slice(start, end);
    chunks.push(decode(chunkTokens));
    start += maxTokens - overlap;
  }

  return chunks;
}

// Retry mechanism with exponential backoff
export async function retry(fn, retries) {
  let attempt = 0;
  const maxDelay = 8000; // Max delay of 8 seconds

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const delay = Math.min(1000 * 2 ** attempt, maxDelay);
      logger.warn(
        `Attempt ${attempt} failed. Retrying in ${delay}ms... Error: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed after ${retries} retries.`);
}
