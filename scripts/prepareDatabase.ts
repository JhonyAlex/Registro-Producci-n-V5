import { prepareDatabase } from './database';

prepareDatabase().catch((error) => {
  console.error('Database preparation failed.', error);
  process.exit(1);
});