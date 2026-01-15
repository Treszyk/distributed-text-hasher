const { createClient } = require('redis');
const { exec } = require('child_process');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const QUEUE_NAME = 'queue:jobs';
const MIN_WORKERS = 1;
const MAX_WORKERS = 10;
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
			`docker compose up -d --scale worker=${count} --no-recreate`,
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
};

main();
