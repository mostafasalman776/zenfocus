// --- State Management ---
let timerInterval = null;
let timerTimeLeft = 25 * 60; // 25 minutes in seconds
let timerDuration = 25 * 60;
let timerType = 'focus'; // 'focus', 'short', 'long'
let timerIsRunning = false;

// Audio Context for programmatically generated sounds (Brown Noise & Chime)
let audioCtx = null;
let brownNoiseSource = null;
let brownNoiseGainNode = null;
let brownNoiseBuffer = null;

// Quotes Database
const quotes = [
    { text: "الهدوء هو مصدر القوة الحقيقي، والتركيز هو مفتاح الإنجاز.", author: "حكمة قديمة" },
    { text: "الأشياء العظيمة تُنجز بسلسلة من الأعمال الصغيرة المجموعة معاً.", author: "فينسنت فان جوخ" },
    { text: "كن هادئاً، فكل شيء سيمر في وقته المناسب.", author: "مجهول" },
    { text: "إنك لا تحتاج إلى رؤية السلالم بأكملها، فقط اتخذ الخطوة الأولى.", author: "مارتن لوثر كينغ" },
    { text: "البساطة هي قمة الفخامة والجمال.", author: "ليوناردو دا فينشي" },
    { text: "طريق الألف ميل يبدأ بـ خطوة واحدة.", author: "لاوتسو" },
    { text: "ركز على رحلتك، لا تقارن سرعتك بالآخرين.", author: "نصيحة دافئة" },
    { text: "التنفس بعمق هو تذكير بسيط بأنك هنا، والآن.", author: "وعي ذاتي" }
];

// --- DOM Elements ---
const themeToggle = document.getElementById('theme-toggle');
const sessionBtns = document.querySelectorAll('.session-btn');
const timerTimeDisplay = document.getElementById('timer-time');
const timerStatusDisplay = document.getElementById('timer-status');
const timerToggleBtn = document.getElementById('timer-toggle');
const timerResetBtn = document.getElementById('timer-reset');
const progressRingBar = document.getElementById('progress-ring-bar');

const soundVolumeSliders = document.querySelectorAll('.sound-volume');
const soundToggleBtns = document.querySelectorAll('.sound-toggle-btn');

const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');

const quoteText = document.getElementById('quote-text');
const quoteAuthor = document.getElementById('quote-author');
const quoteRefreshBtn = document.getElementById('quote-refresh');

const localTimeDisplay = document.getElementById('local-time');

// --- SVG Circular Progress Setup ---
const radius = progressRingBar.r.baseVal.value;
const circumference = 2 * Math.PI * radius;
progressRingBar.style.strokeDasharray = `${circumference} ${circumference}`;
progressRingBar.style.strokeDashoffset = circumference;

function setProgress(percent) {
    const offset = circumference - (percent / 100) * circumference;
    progressRingBar.style.strokeDashoffset = offset;
}

// --- Theme Switcher ---
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light-theme';
    document.body.className = savedTheme;
    updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
    const icon = themeToggle.querySelector('i');
    if (theme === 'dark-theme') {
        icon.className = 'fa-solid fa-sun';
    } else {
        icon.className = 'fa-solid fa-moon';
    }
}

themeToggle.addEventListener('click', () => {
    let currentTheme = document.body.className;
    let nextTheme = currentTheme === 'light-theme' ? 'dark-theme' : 'light-theme';
    document.body.className = nextTheme;
    localStorage.setItem('theme', nextTheme);
    updateThemeIcon(nextTheme);
});

// --- Timer Logic ---
function updateTimerDisplay() {
    const minutes = Math.floor(timerTimeLeft / 60);
    const seconds = timerTimeLeft % 60;
    timerTimeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Update SVG progress ring
    const percentage = ((timerDuration - timerTimeLeft) / timerDuration) * 100;
    setProgress(100 - percentage);
}

function switchSession(type) {
    timerType = type;
    clearInterval(timerInterval);
    timerIsRunning = false;
    timerToggleBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    
    sessionBtns.forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (type === 'focus') {
        timerDuration = 25 * 60;
        timerStatusDisplay.textContent = 'وقت التركيز';
    } else if (type === 'short') {
        timerDuration = 5 * 60;
        timerStatusDisplay.textContent = 'راحة قصيرة';
    } else if (type === 'long') {
        timerDuration = 15 * 60;
        timerStatusDisplay.textContent = 'راحة طويلة';
    }
    
    timerTimeLeft = timerDuration;
    updateTimerDisplay();
}

sessionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        switchSession(btn.dataset.type);
    });
});

timerToggleBtn.addEventListener('click', () => {
    if (timerIsRunning) {
        // Pause timer
        clearInterval(timerInterval);
        timerIsRunning = false;
        timerToggleBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    } else {
        // Start timer
        timerIsRunning = true;
        timerToggleBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        timerInterval = setInterval(() => {
            if (timerTimeLeft > 0) {
                timerTimeLeft--;
                updateTimerDisplay();
            } else {
                clearInterval(timerInterval);
                timerIsRunning = false;
                timerToggleBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                playChime(); // Play synthesized end alarm
                handleSessionComplete();
            }
        }, 1000);
    }
});

timerResetBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerIsRunning = false;
    timerToggleBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    timerTimeLeft = timerDuration;
    updateTimerDisplay();
});

function handleSessionComplete() {
    if (timerType === 'focus') {
        timerStatusDisplay.textContent = 'أحسنت! وقت الراحة الآن';
        setTimeout(() => switchSession('short'), 2000);
    } else {
        timerStatusDisplay.textContent = 'انتهت الاستراحة! لنبدأ مجدداً';
        setTimeout(() => switchSession('focus'), 2000);
    }
}

// --- Web Audio Synthesizers (High tech, zero external dependencies) ---
function initAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Synthesize a cozy chime (bell crystal noise) when Pomodoro finishes
function playChime() {
    initAudioCtx();
    const now = audioCtx.currentTime;
    
    // Play dual oscillator chime
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(523.25, now); // C5 note
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // Slide to A5
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now); // E5 note
    
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 2.1);
    osc2.stop(now + 2.1);
}

// Programmatic Brown Noise Generator
function getBrownNoiseBuffer() {
    if (brownNoiseBuffer) return brownNoiseBuffer;
    
    initAudioCtx();
    const bufferSize = 10 * audioContextSampleRate(); // 10 seconds of noise
    brownNoiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = brownNoiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Simple first-order lowpass filter (integrator) to shift white to brown noise spectrum
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Boost amplitude to compensate for gain loss in filtering
    }
    
    return brownNoiseBuffer;
}

function audioContextSampleRate() {
    return audioCtx ? audioCtx.sampleRate : 44100;
}

function toggleBrownNoise(play, volume) {
    initAudioCtx();
    
    if (play) {
        if (brownNoiseSource) return; // Already running
        
        brownNoiseSource = audioCtx.createBufferSource();
        brownNoiseSource.buffer = getBrownNoiseBuffer();
        brownNoiseSource.loop = true;
        
        brownNoiseGainNode = audioCtx.createGain();
        brownNoiseGainNode.gain.value = volume;
        
        brownNoiseSource.connect(brownNoiseGainNode);
        brownNoiseGainNode.connect(audioCtx.destination);
        brownNoiseSource.start();
    } else {
        if (brownNoiseSource) {
            try {
                brownNoiseSource.stop();
            } catch(e) {}
            brownNoiseSource.disconnect();
            brownNoiseSource = null;
            brownNoiseGainNode = null;
        }
    }
}

// --- Audio Controls ---
soundToggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const item = btn.closest('.sound-item');
        const soundName = item.dataset.sound;
        const volumeInput = item.querySelector('.sound-volume');
        const volumeValue = parseFloat(volumeInput.value);
        const isActive = item.classList.contains('active');
        
        initAudioCtx();

        if (isActive) {
            // Stop sound
            item.classList.remove('active');
            btn.innerHTML = '<i class="fa-solid fa-play"></i>';
            if (soundName === 'focus-noise') {
                toggleBrownNoise(false);
            } else {
                const audio = document.getElementById(`audio-${soundName}`);
                if (audio) audio.pause();
            }
        } else {
            // Start sound
            item.classList.add('active');
            btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            if (soundName === 'focus-noise') {
                toggleBrownNoise(true, volumeValue);
            } else {
                const audio = document.getElementById(`audio-${soundName}`);
                if (audio) {
                    audio.volume = volumeValue;
                    audio.play().catch(err => {
                        console.log("Audio play blocked by browser. Audio context initialized.", err);
                    });
                }
            }
        }
    });
});

soundVolumeSliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        const item = slider.closest('.sound-item');
        const soundName = item.dataset.sound;
        const volumeValue = parseFloat(slider.value);
        const isActive = item.classList.contains('active');
        
        if (soundName === 'focus-noise') {
            if (brownNoiseGainNode && isActive) {
                brownNoiseGainNode.gain.setValueAtTime(volumeValue, audioCtx.currentTime);
            }
        } else {
            const audio = document.getElementById(`audio-${soundName}`);
            if (audio) {
                audio.volume = volumeValue;
            }
        }
    });
});

// --- To-Do List Logic ---
let tasks = [];

function loadTasks() {
    const saved = localStorage.getItem('tasks');
    if (saved) {
        tasks = JSON.parse(saved);
        renderTasks();
    }
}

function saveTasks() {
    localStorage.setItem('tasks', JSON.stringify(tasks));
}

function renderTasks() {
    todoList.innerHTML = '';
    
    if (tasks.length === 0) {
        const placeholder = document.createElement('li');
        placeholder.className = 'todo-item-placeholder';
        placeholder.style.textAlign = 'center';
        placeholder.style.color = 'var(--text-secondary)';
        placeholder.style.padding = '1.5rem';
        placeholder.style.fontSize = '0.9rem';
        placeholder.textContent = 'لا توجد مهام حالياً. أضف مهمة للبدء!';
        todoList.appendChild(placeholder);
        return;
    }

    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `todo-item ${task.completed ? 'completed' : ''}`;
        li.dataset.id = task.id;
        
        li.innerHTML = `
            <div class="todo-item-left">
                <div class="todo-checkbox">
                    <i class="fa-solid fa-check"></i>
                </div>
                <span class="todo-text">${escapeHtml(task.text)}</span>
            </div>
            <button class="todo-delete-btn" aria-label="حذف المهمة">
                <i class="fa-regular fa-trash-can"></i>
            </button>
        `;

        // Toggle Complete
        li.querySelector('.todo-item-left').addEventListener('click', () => {
            task.completed = !task.completed;
            saveTasks();
            renderTasks();
        });

        // Delete Task
        li.querySelector('.todo-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            // Apply a slide-out delete animation before removing
            li.style.transform = 'translateX(50px)';
            li.style.opacity = '0';
            li.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                tasks = tasks.filter(t => t.id !== task.id);
                saveTasks();
                renderTasks();
            }, 300);
        });

        todoList.appendChild(li);
    });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    
    const newTask = {
        id: Date.now(),
        text: text,
        completed: false
    };
    
    tasks.push(newTask);
    saveTasks();
    todoInput.value = '';
    renderTasks();
});

// --- Calming Quotes Logic ---
function loadRandomQuote() {
    // Fade out
    quoteText.style.opacity = 0;
    quoteAuthor.style.opacity = 0;
    
    setTimeout(() => {
        const randomIndex = Math.floor(Math.random() * quotes.length);
        const quote = quotes[randomIndex];
        quoteText.textContent = `"${quote.text}"`;
        quoteAuthor.textContent = quote.author;
        
        // Fade in
        quoteText.style.opacity = 1;
        quoteAuthor.style.opacity = 1;
    }, 300);
}

// Add simple CSS transitions for quote fading
quoteText.style.transition = 'opacity 0.3s ease';
quoteAuthor.style.transition = 'opacity 0.3s ease';

quoteRefreshBtn.addEventListener('click', loadRandomQuote);

// --- Clock Logic ---
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    localTimeDisplay.textContent = `${hours}:${minutes}`;
}

// --- Initialization ---
initTheme();
updateTimerDisplay();
loadTasks();
loadRandomQuote();
updateClock();
setInterval(updateClock, 1000);

// Auto-rotate quote every 2 minutes
setInterval(loadRandomQuote, 120000);
