import express, { Request, Response } from 'express';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const QUEUE_NAME = 'queue:jobs';

const redisClient = createClient({
	url: `redis://${REDIS_HOST}:6379`,
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

app.post('/jobs/text', async (req: Request, res: Response) => {
	try {
		const { text, algorithm } = req.body;

		if (!text) {
			return res.status(400).json({ error: 'Text is required' });
		}

		if (algorithm !== 'sha256' && algorithm !== 'bcrypt') {
			return res
				.status(400)
				.json({ error: 'Only sha256 and bcrypt algorithms are supported' });
		}

		const queueLength = await redisClient.lLen(QUEUE_NAME);
		if (queueLength >= 5000) {
			return res
				.status(429)
				.json({ error: 'System overloaded. Please try again later.' });
		}

		const jobId = uuidv4();
		const jobData = {
			jobId,
			text,
			algorithm,
			status: 'queued',
			createdAt: new Date().toISOString(),
		};

		await redisClient.hSet(`job:${jobId}`, {
			status: 'queued',
			algorithm,
			text,
			createdAt: jobData.createdAt,
		});

		await redisClient.lPush('queue:jobs', JSON.stringify(jobData));

		console.log(`Job ${jobId} queued`);

		res.status(202).json({
			jobId,
			status: 'queued',
		});
	} catch (error) {
		console.error('Error creating job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.post('/jobs/batch', async (req: Request, res: Response) => {
	try {
		const { jobIds } = req.body;
		if (!Array.isArray(jobIds)) {
			return res.status(400).json({ error: 'jobIds must be an array' });
		}

		const pipeline = redisClient.multi();
		jobIds.forEach((id) => pipeline.hGetAll(`job:${id}`));
		const results = await pipeline.exec();

		const jobs = results.map((job: any, index) => {
			const jobId = jobIds[index];
			if (!job || Object.keys(job).length === 0)
				return { jobId, status: 'unknown' };

			return {
				jobId,
				status: job.status,
				workerId: job.workerId,
				hash: job.hash,
				text: job.text,
				error: job.error,
				retries: job.retries,
			};
		});

		res.json(jobs);
	} catch (error) {
		console.error('Error fetching batch jobs:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/jobs/:jobId', async (req: Request, res: Response) => {
	try {
		const { jobId } = req.params;
		const jobKey = `job:${jobId}`;

		const job = await redisClient.hGetAll(jobKey);

		if (!job || Object.keys(job).length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		if (job.status === 'done') {
			return res.json({
				jobId,
				status: job.status,
				algorithm: job.algorithm,
				hash: job.hash,
				finishedAt: job.finishedAt,
			});
		}

		if (job.status === 'processing') {
			return res.json({
				jobId,
				status: job.status,
				workerId: job.workerId,
				retries: job.retries,
			});
		}

		return res.json({
			jobId,
			status: job.status,
			error: job.error,
		});
	} catch (error) {
		console.error('Error fetching job:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/stats', async (req: Request, res: Response) => {
	try {
		const workerKeys = await redisClient.keys('worker:heartbeat:*');
		const activeWorkers = workerKeys.length;
		const queueLength = await redisClient.lLen(QUEUE_NAME);
		const scalerStatus = (await redisClient.get('scaler:status')) || 'idle';

		res.json({
			activeWorkers,
			queueLength,
			scalerStatus,
		});
	} catch (error) {
		console.error('Error fetching stats:', error);
		res.status(500).json({ error: 'Error fetching stats' });
	}
});

app.delete('/queue', async (req: Request, res: Response) => {
	try {
		await redisClient.del(QUEUE_NAME);
		res.json({ message: 'Queue cleared' });
	} catch (error) {
		console.error('Error clearing queue:', error);
		res.status(500).json({ error: 'Error clearing queue' });
	}
});

app.get('/admin/scaling', async (req: Request, res: Response) => {
	try {
		const enabled = await redisClient.get('config:autoscaling');
		res.json({ enabled: enabled !== 'false' });
	} catch (error) {
		console.error('Error fetching scaling config:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.post('/admin/scaling', async (req: Request, res: Response) => {
	try {
		const { enabled } = req.body;
		if (typeof enabled !== 'boolean') {
			return res.status(400).json({ error: 'enabled must be a boolean' });
		}
		await redisClient.set('config:autoscaling', String(enabled));
		res.json({ enabled });
	} catch (error) {
		console.error('Error updating scaling config:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/health', (req, res) => {
	res.json({ ok: true });
});

const start = async () => {
	await redisClient.connect();
	app.listen(PORT, () => {
		console.log(`API Server running on port ${PORT}`);
	});
};

start();
