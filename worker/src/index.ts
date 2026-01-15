import { createClient, commandOptions } from 'redis';
import crypto from 'crypto';
import os from 'os';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;

const redisClient = createClient({
	url: `redis://${REDIS_HOST}:6379`,
});

const SIMULATED_DELAY_MS = parseInt(
	process.env.SIMULATED_DELAY_MS || '2000',
	10
);
const HEARTBEAT_INTERVAL_MS = 1000;

redisClient.on('error', (err) => console.log('Redis Client Error', err));

const listener = redisClient.duplicate();
listener.on('error', (err) => console.log('Redis Listener Error', err));

const sendHeartbeat = async () => {
	try {
		await redisClient.set(`worker:heartbeat:${WORKER_ID}`, '1', {
			EX: 3,
		});
	} catch (error) {
		console.error('Heartbeat error:', error);
	}
};

const processJob = async (jobDataStr: string) => {
	try {
		const job = JSON.parse(jobDataStr);
		const { jobId, text, algorithm } = job;
		console.log(`${WORKER_ID}: Processing job ${jobId}`);

		await redisClient.hSet(`job:${jobId}`, {
			status: 'processing',
			workerId: WORKER_ID,
			startedAt: new Date().toISOString(),
		});

		if (SIMULATED_DELAY_MS > 0) {
			await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS));
		}

		let hashResult = '';
		if (algorithm === 'sha256') {
			hashResult = crypto.createHash('sha256').update(text).digest('hex');
		} else {
			throw new Error(`Unsupported algorithm: ${algorithm}`);
		}

		await redisClient.hSet(`job:${jobId}`, {
			status: 'done',
			hash: hashResult,
			finishedAt: new Date().toISOString(),
		});

		console.log(`${WORKER_ID}: Finished job ${jobId}`);
	} catch (error: any) {
		console.error('Error processing job:', error);
		try {
			const job = JSON.parse(jobDataStr);
			if (job && job.jobId) {
				await redisClient.hSet(`job:${job.jobId}`, {
					status: 'failed',
					error: error.message || 'Unknown error',
					finishedAt: new Date().toISOString(),
				});
			}
		} catch (e) {
			console.error('Failed to mark job as failed:', e);
		}
	}
};

const main = async () => {
	await redisClient.connect();
	await listener.connect();

	console.log(`Worker ${WORKER_ID} started, waiting for jobs...`);

	setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

	let isProcessing = false;
	let currentJobId: string | null = null;
	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) return;
		isShuttingDown = true;
		console.log(`${WORKER_ID}: Shutting down...`);

		if (isProcessing && currentJobId) {
			console.log(
				`${WORKER_ID}: Marking job ${currentJobId} as failed due to shutdown`
			);
			try {
				await redisClient.hSet(`job:${currentJobId}`, {
					status: 'failed',
					error: 'Worker shutting down',
					finishedAt: new Date().toISOString(),
				});
			} catch (e) {
				console.error('Error marking job failed during shutdown', e);
			}
		}

		try {
			await listener.disconnect();
			await redisClient.disconnect();
		} catch (e) {
			console.error('Error disconnecting Redis', e);
		}

		process.exit(0);
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	while (!isShuttingDown) {
		try {
			const result = await listener.brPop(
				commandOptions({ isolated: true }),
				'queue:jobs',
				0
			);

			if (isShuttingDown) break;

			if (result) {
				isProcessing = true;
				const job = JSON.parse(result.element);
				currentJobId = job.jobId;
				await processJob(result.element);
				isProcessing = false;
				currentJobId = null;
			}
		} catch (error) {
			if (isShuttingDown) break;
			console.error('Error in worker loop:', error);
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	}
};

main();
