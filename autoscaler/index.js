const { createClient } = require('redis');
const { exec } = require('child_process');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const QUEUE_NAME = 'queue:jobs';
const MIN_WORKERS = parseInt(process.env.MIN_WORKERS || '1', 10);
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || '10', 10);
const CHECK_INTERVAL = 500;

let currentWorkers = 1;
let isScaling = false;

const redisClient = createClient({
	url: `redis://${REDIS_HOST}:6379`,
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

const getActiveWorkers = async () => {
	const keys = await redisClient.keys('worker:heartbeat:*');
	return keys.length;
};

const setScalerStatus = async (status) => {
	try {
		await redisClient.set('scaler:status', status, { EX: 10 });
	} catch (e) {
		console.error('Error setting status', e);
	}
};

const scaleWorkers = (count) => {
	return new Promise((resolve, reject) => {
		if (isScaling) return resolve();
		isScaling = true;

		console.log(`Scaling workers to ${count}...`);
		exec(
			`docker compose up -d --scale worker=${count} --no-recreate worker`,
			{ cwd: '/project' },
			(error, stdout, stderr) => {
				isScaling = false;
				if (error) {
					console.error(`Error scaling: ${error.message}`);
					reject(error);
					return;
				}
				currentWorkers = count;
				console.log(`Scaled to ${count} workers`);
				resolve();
			}
		);
	});
};

const checkQueue = async () => {
	try {
		const scalingEnabled = await redisClient.get('config:autoscaling');
		if (scalingEnabled === 'false') {
			await setScalerStatus('paused');
			return;
		}

		const queueLength = await redisClient.lLen(QUEUE_NAME);

		const activeWorkers = await getActiveWorkers();
		if (!isScaling) {
			currentWorkers = activeWorkers;
		}

		console.log(`Queue: ${queueLength}, Workers: ${currentWorkers}`);

		let desiredWorkers = currentWorkers;

		if (queueLength > 0) {
			desiredWorkers = Math.min(Math.ceil(queueLength / 2), MAX_WORKERS);

			if (desiredWorkers > currentWorkers) {
				await setScalerStatus('scaling_up');
				await scaleWorkers(desiredWorkers);
			} else if (desiredWorkers < currentWorkers && queueLength === 0) {
				await setScalerStatus('scaling_down');
				await scaleWorkers(desiredWorkers);
			} else {
				await setScalerStatus('idle');
			}
		} else if (currentWorkers > MIN_WORKERS) {
			await setScalerStatus('scaling_down');
			await scaleWorkers(MIN_WORKERS);
		} else {
			await setScalerStatus('idle');
		}
	} catch (error) {
		console.error('Error checking queue:', error);
	}
};

const main = async () => {
	await redisClient.connect();
	console.log('Autoscaler started. Monitoring queue...');

	setInterval(checkQueue, CHECK_INTERVAL);
	setInterval(cleanupStaleJobs, 10000);
};

const cleanupStaleJobs = async () => {
	try {
		const workerKeys = await redisClient.keys('worker:heartbeat:*');
		const activeWorkerIds = new Set(workerKeys.map((k) => k.split(':').pop()));

		const jobKeys = await redisClient.keys('job:*');

		for (const key of jobKeys) {
			const job = await redisClient.hGetAll(key);

			if (job.status === 'processing' && job.workerId) {
				if (!activeWorkerIds.has(job.workerId)) {
					const retries = parseInt(job.retries || '0', 10);

					if (retries < 3) {
						if (!job.text) {
							console.log(
								`Found stale job ${job.jobId} (worker ${job.workerId} dead). Missing 'text' - cannot retry.`
							);
							await redisClient.hSet(key, {
								status: 'failed',
								error: 'Worker crashed (Data lost - cannot retry)',
								finishedAt: new Date().toISOString(),
							});
							continue;
						}

						console.log(
							`Found stale job ${job.jobId} (worker ${
								job.workerId
							} dead). Retrying (${retries + 1}/3)...`
						);

						await redisClient.hSet(key, {
							status: 'queued',
							workerId: '',
							retries: retries + 1,
							updatedAt: new Date().toISOString(),
						});

						const jobId = key.split(':')[1];
						const jobData = {
							jobId: jobId,
							text: job.text,
							algorithm: job.algorithm || 'sha256',
							status: 'queued',
							retries: retries + 1,
						};

						await redisClient.lPush('queue:jobs', JSON.stringify(jobData));
					} else {
						console.log(
							`Found stale job ${job.jobId} (worker ${job.workerId} dead). Max retries reached. Marking failed.`
						);
						await redisClient.hSet(key, {
							status: 'failed',
							error: 'Worker crashed (Max retries exceeded)',
							finishedAt: new Date().toISOString(),
						});
					}
				}
			}
		}
	} catch (e) {
		console.error('Error in janitor:', e);
	}
};

main();
