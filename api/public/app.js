let myJobs = [];
const API_URL = '';
const MAX_JOBS = 10000;
const VISIBLE_DONE_LIMIT = 50;

async function createJob(textOverride = null, shouldRender = true) {
	const input = document.getElementById('jobText');
	const text = textOverride || input.value;
	if (!text) return;

	try {
		const res = await fetch(`${API_URL}/jobs/text`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, algorithm: 'bcrypt' }),
		});
		const data = await res.json();

		myJobs.unshift({
			jobId: data.jobId,
			status: 'queued',
			text: text.substring(0, 50),
			timestamp: Date.now(),
		});
		pruneJobs();
		if (shouldRender) renderJobs();
		if (!textOverride) input.value = '';
	} catch (err) {
		console.error(err);
	}
}

async function handleFileUpload(input) {
	const file = input.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = async (e) => {
		const text = e.target.result;
		const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

		if (lines.length === 0) {
			alert('File is empty');
			return;
		}

		if (
			lines.length > MAX_JOBS &&
			!confirm(
				`File contains ${lines.length} lines. Only the first ${MAX_JOBS} will be tracked in UI. Continue?`
			)
		) {
			input.value = '';
			return;
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Render every 10 items to keep UI alive but responsive
			const shouldRender = i % 10 === 0 || i === lines.length - 1;
			await createJob(line.trim(), shouldRender);
			await new Promise((r) => setTimeout(r, 20));
		}

		input.value = '';
	};
	reader.readAsText(file);
}

function exportResults() {
	const doneJobs = myJobs.filter((j) => j.status === 'done');
	if (doneJobs.length === 0) {
		alert('No completed jobs to export.');
		return;
	}

	const content = doneJobs.map((j) => `${j.text} : ${j.hash}`).join('\n');

	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `hashes_${Date.now()}.txt`;
	a.click();
	URL.revokeObjectURL(url);
}

async function floodJobs(count) {
	const baseText = 'Flood task ' + Date.now();
	for (let i = 0; i < count; i++) {
		await createJob(`${baseText} #${i + 1}`, i === count - 1);
	}
}

async function clearQueue() {
	if (!confirm('Clear all pending jobs from server?')) return;
	try {
		await fetch(`${API_URL}/queue`, { method: 'DELETE' });
		myJobs = myJobs.filter((j) => j.status !== 'queued');
		renderJobs();
	} catch (err) {
		alert('Failed to clear queue');
	}
}

function pruneJobs() {
	if (myJobs.length <= MAX_JOBS) return;

	const active = myJobs.filter(
		(j) => j.status !== 'done' && j.status !== 'failed'
	);
	const done = myJobs.filter(
		(j) => j.status === 'done' || j.status === 'failed'
	);

	if (active.length >= MAX_JOBS) {
		myJobs = active.slice(0, MAX_JOBS);
	} else {
		const slotsForDone = MAX_JOBS - active.length;
		const keptDone = done.slice(0, slotsForDone);

		myJobs = [...active, ...keptDone].sort((a, b) => b.timestamp - a.timestamp);
	}
}

async function updateStats() {
	try {
		const res = await fetch(`${API_URL}/stats`);
		const data = await res.json();
		document.getElementById('activeWorkers').textContent = data.activeWorkers;
		document.getElementById('queueLength').textContent = data.queueLength;

		const statusEl = document.getElementById('scalerStatus');
		if (data.scalerStatus === 'scaling_up') {
			statusEl.textContent = 'Scaling Up ▲';
			statusEl.style.color = '#28a745';
		} else if (data.scalerStatus === 'scaling_down') {
			statusEl.textContent = 'Scaling Down ▼';
			statusEl.style.color = '#dc3545';
		} else if (data.scalerStatus === 'paused') {
			statusEl.textContent = 'Paused';
			statusEl.style.color = '#6c757d';
		} else {
			statusEl.textContent = '';
		}
	} catch (err) {
		console.error('Stats error', err);
	}
}

async function pollJobs() {
	const activeJobs = myJobs.filter(
		(j) => j.status !== 'done' && j.status !== 'failed'
	);
	if (activeJobs.length === 0) return;

	const jobIds = activeJobs.map((j) => j.jobId);

	try {
		const res = await fetch(`${API_URL}/jobs/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jobIds }),
		});
		const updates = await res.json();

		let hasChanges = false;
		updates.forEach((update) => {
			const index = myJobs.findIndex((j) => j.jobId === update.jobId);
			if (index !== -1) {
				if (myJobs[index].status !== update.status) {
					myJobs[index] = { ...myJobs[index], ...update };
					hasChanges = true;
				}
			}
		});

		if (hasChanges) renderJobs();
	} catch (err) {
		console.error('Batch poll error', err);
	}
}

function renderJobs() {
	document.getElementById('jobCount').textContent = `(${myJobs.length})`;

	const lists = {
		queued: document.getElementById('list-queued'),
		processing: document.getElementById('list-processing'),
		done: document.getElementById('list-done'),
	};

	const counts = { queued: 0, processing: 0, done: 0 };

	Object.values(lists).forEach((el) => (el ? (el.innerHTML = '') : null));

	myJobs.forEach((job) => {
		let status = job.status === 'failed' ? 'done' : job.status;
		if (!lists[status]) status = 'queued';

		counts[status]++;

		if (status === 'done' && counts[status] > VISIBLE_DONE_LIMIT) {
			return;
		}

		const targetList = lists[status];

		if (targetList) {
			const card = document.createElement('div');
			card.className = 'job-card';

			if (job.status === 'failed') {
				card.style.borderLeftColor = '#dc3545';
				card.style.background = '#fff5f5';
			}

			card.innerHTML = `
                <div class="card-top">
                    <div style="display:flex; align-items:center;">
                        <span class="card-id">${job.jobId.split('-')[0]}</span>
                        ${
													job.retries > 0
														? `<span class="retry-badge" title="Retry #${job.retries}"></span>`
														: ''
												}
                    </div>

                    <span class="worker-badge">${job.workerId || ''}</span>
                </div>
                <div class="card-content">${
									job.textPreview || job.text || '...'
								}</div>
                ${
									job.status === 'failed'
										? `<div class="card-hash" style="color: #dc3545; background: #ffebeb;">Error: ${
												job.error || 'Unknown'
										  }</div>`
										: job.hash
										? `<div class="card-hash">${job.hash.substring(
												0,
												20
										  )}...</div>`
										: ''
								}
            `;
			targetList.appendChild(card);
		}
	});

	document.getElementById('count-queued').textContent = `(${counts.queued})`;
	document.getElementById(
		'count-processing'
	).textContent = `(${counts.processing})`;

	const visibleDone = Math.min(counts.done, VISIBLE_DONE_LIMIT);
	document.getElementById(
		'count-done'
	).textContent = `(${counts.done}) [Showing ${visibleDone}]`;
}

function clearJobs() {
	myJobs = [];
	renderJobs();
}

async function toggleScaling() {
	const toggle = document.getElementById('scalingToggle');
	const enabled = toggle.checked;

	try {
		await fetch(`${API_URL}/admin/scaling`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled }),
		});
	} catch (err) {
		toggle.checked = !enabled;
		alert('Failed to update scaling config');
	}
}

async function initScalingState() {
	try {
		const res = await fetch(`${API_URL}/admin/scaling`);
		const data = await res.json();
		document.getElementById('scalingToggle').checked = data.enabled;
	} catch (err) {
		console.error(err);
	}
}

initScalingState();
renderJobs();
setInterval(updateStats, 100);
setInterval(pollJobs, 100);
updateStats();
