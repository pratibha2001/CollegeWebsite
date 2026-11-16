import 'dotenv/config';
import app from './app.js';
import { startOutboxWorker } from './shared/outbox.worker.js';

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));

startOutboxWorker();