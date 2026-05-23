import './style.css'
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('New content available. Reload?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  },
})

// State
let currentView = 'dashboard'; // 'dashboard' | 'quiz' | 'score' | 'endless'
let catalogData = null;

// Standard Quiz State
let currentCategory = null;
let currentQuestions = [];
let currentQuestionIndex = 0;
let userAnswers = {}; // { questionId: selectedOptionLabel }
let score = 0;

// Endless Quiz State
let endlessMode = 'normal'; // 'normal' | 'solved' | 'unsolved' | 'remix'
let endlessProgress = JSON.parse(localStorage.getItem('endlessProgress') || '{"solvedIds":[], "catIdx":0, "pageIdx":1}');
let endlessHistory = [];
let endlessHistoryIndex = -1;
let endlessQuestionsBuffer = [];
let endlessSessionAnswers = {}; // { qKey: selectedLabel }
let isFetchingQuestion = false;

// DOM Elements
const appDiv = document.querySelector('#app');

// Initialization
async function init() {
  renderLoader();
  try {
    const res = await fetch('/data/quizbase/_catalog.json');
    if (!res.ok) throw new Error('Failed to load catalog');
    catalogData = await res.json();
    renderDashboard();
  } catch (error) {
    console.error(error);
    appDiv.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <h3>Failed to load data</h3>
        <p>Make sure the data folder is properly set up.</p>
        <button class="btn btn-primary" style="margin-top: 1rem" onclick="window.location.reload()">Retry</button>
      </div>
    `;
  }
}

// Rendering Functions
function renderLoader() {
  appDiv.innerHTML = `
    <div class="loader-container">
      <span class="loader"></span>
    </div>
  `;
}

function renderDashboard(searchTerm = '') {
  currentView = 'dashboard';
  
  const categories = catalogData.categories.filter(cat => 
    cat.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  let html = `
    <header class="header fade-in">
      <h1>
        <svg width="32" height="32" fill="none" stroke="var(--primary-color)" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
        GK <span class="text-gradient">Quiz Master</span>
      </h1>
      <div class="header-controls">
         <button class="btn btn-primary" id="startEndlessBtn">
           <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
           Endless Quiz
         </button>
         <div class="text-secondary">Total Categories: ${catalogData.total_categories}</div>
      </div>
    </header>

    <div class="search-container fade-in" style="animation-delay: 0.1s">
      <svg class="search-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
      <input type="text" id="searchInput" class="search-input" placeholder="Search for topics, exams, or keywords..." value="${searchTerm}">
    </div>
  `;

  if (categories.length === 0) {
    html += `
      <div class="empty-state fade-in" style="animation-delay: 0.2s">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <h3>No results found</h3>
        <p>Try adjusting your search term.</p>
      </div>
    `;
  } else {
    html += `<div class="grid grid-cols-3 fade-in" style="animation-delay: 0.2s" id="categoryGrid">`;
    categories.slice(0, 50).forEach(cat => { // Limit to 50 for performance
      html += `
        <div class="category-card" data-slug="${cat.slug}">
          <h3>${cat.title}</h3>
          <div class="category-meta">
            <span>${cat.estimated_total} MCQs</span>
            <span class="badge">Start Quiz</span>
          </div>
        </div>
      `;
    });
    html += `</div>`;
    
    if(categories.length > 50) {
        html += `<p class="text-center text-secondary" style="margin-top: 2rem;">Showing 50 of ${categories.length} results. Refine search to see more.</p>`;
    }
  }

  appDiv.innerHTML = html;

  // Event Listeners for Dashboard
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    clearTimeout(window.searchTimeout);
    window.searchTimeout = setTimeout(() => {
      renderDashboard(e.target.value);
    }, 300);
  });

  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => loadQuiz(card.dataset.slug));
  });

  document.getElementById('startEndlessBtn')?.addEventListener('click', () => {
    startEndlessQuiz('normal');
  });
}

// --- STANDARD QUIZ LOGIC ---

async function loadQuiz(slug) {
  renderLoader();
  try {
    currentCategory = catalogData.categories.find(c => c.slug === slug);
    const res = await fetch(`/data/quizbase/${slug}/page-01.json`);
    if (!res.ok) throw new Error('Failed to load quiz data');
    const data = await res.json();
    
    currentQuestions = data.questions;
    currentQuestionIndex = 0;
    userAnswers = {};
    score = 0;
    
    renderQuiz();
  } catch (error) {
    console.error(error);
    alert("Failed to load this quiz. The data might be missing.");
    renderDashboard();
  }
}

function renderQuiz() {
  currentView = 'quiz';
  const question = currentQuestions[currentQuestionIndex];
  const isAnswered = userAnswers[question.id] !== undefined;
  
  let html = `
    <div class="glass-panel fade-in">
      <div class="quiz-header">
        <button class="btn btn-outline" id="backBtn">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Back
        </button>
        <div class="quiz-progress">
          Question ${currentQuestionIndex + 1} of ${currentQuestions.length}
        </div>
      </div>

      <div class="question-container">
        <h2 class="question-text">${question.question}</h2>
        <div class="options-grid">
  `;

  question.options.forEach(opt => {
    let classes = 'option-btn';
    let disabled = isAnswered ? 'disabled' : '';
    
    if (isAnswered) {
      if (opt.label === question.answer.label) {
        classes += ' correct';
      } else if (opt.label === userAnswers[question.id]) {
        classes += ' incorrect';
      }
    }

    html += `
      <button class="${classes}" data-label="${opt.label}" ${disabled}>
        <span class="option-label">${opt.label}</span>
        <span>${opt.text}</span>
      </button>
    `;
  });

  html += `</div>`;

  if (isAnswered) {
    html += `
      <div class="explanation">
        <h4>
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Explanation
        </h4>
        <p>${question.explanation}</p>
      </div>
      
      <div style="margin-top: 2rem; display: flex; justify-content: flex-end;">
        <button class="btn btn-primary" id="nextBtn">
          ${currentQuestionIndex < currentQuestions.length - 1 ? 'Next Question' : 'Finish Quiz'}
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
        </button>
      </div>
    `;
  }

  html += `</div>`;
  appDiv.innerHTML = html;

  document.getElementById('backBtn')?.addEventListener('click', () => renderDashboard());
  
  if (!isAnswered) {
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedLabel = e.currentTarget.dataset.label;
        userAnswers[question.id] = selectedLabel;
        if (selectedLabel === question.answer.label) score++;
        renderQuiz();
      });
    });
  }

  document.getElementById('nextBtn')?.addEventListener('click', () => {
    if (currentQuestionIndex < currentQuestions.length - 1) {
      currentQuestionIndex++;
      renderQuiz();
    } else {
      renderScore();
    }
  });
}

function renderScore() {
  currentView = 'score';
  const percentage = Math.round((score / currentQuestions.length) * 100);
  
  const progress = JSON.parse(localStorage.getItem('quizProgress') || '{}');
  progress[currentCategory.slug] = {
    score,
    total: currentQuestions.length,
    percentage,
    date: new Date().toISOString()
  };
  localStorage.setItem('quizProgress', JSON.stringify(progress));

  let message = percentage >= 80 ? 'Excellent work!' : percentage >= 50 ? 'Good effort!' : 'Keep practicing!';

  const html = `
    <div class="glass-panel fade-in score-card">
      <h2>Quiz Completed</h2>
      <p class="text-secondary" style="margin-bottom: 2rem;">${currentCategory.title}</p>
      
      <div class="score-circle" style="--percentage: ${percentage}%">
        <div class="score-value">${percentage}%</div>
      </div>
      
      <h3>${score} out of ${currentQuestions.length} correct</h3>
      <p style="margin: 1rem 0 2rem;">${message}</p>
      
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button class="btn btn-outline" id="retryBtn">Try Again</button>
        <button class="btn btn-primary" id="homeBtn">Back to Catalog</button>
      </div>
    </div>
  `;

  appDiv.innerHTML = html;

  document.getElementById('retryBtn')?.addEventListener('click', () => loadQuiz(currentCategory.slug));
  document.getElementById('homeBtn')?.addEventListener('click', () => renderDashboard());
}

// --- ENDLESS QUIZ LOGIC ---

function saveEndlessProgress() {
  localStorage.setItem('endlessProgress', JSON.stringify(endlessProgress));
}

async function startEndlessQuiz(mode) {
  endlessMode = mode;
  endlessHistory = [];
  endlessHistoryIndex = -1;
  endlessQuestionsBuffer = [];
  endlessSessionAnswers = {};
  
  await advanceEndlessQuiz();
}

async function advanceEndlessQuiz(direction = 1) {
  if (isFetchingQuestion) return;
  
  if (direction === -1) {
    if (endlessHistoryIndex > 0) {
      endlessHistoryIndex--;
      renderEndlessQuiz();
    }
    return;
  }

  // Going forward
  if (endlessHistoryIndex < endlessHistory.length - 1) {
    endlessHistoryIndex++;
    renderEndlessQuiz();
    return;
  }

  // Need to fetch a new question
  isFetchingQuestion = true;
  renderLoader();
  
  const q = await getNextEndlessQuestion();
  if (q) {
    endlessHistory.push(q);
    endlessHistoryIndex++;
  } else {
    alert("No more questions found for the selected mode.");
  }
  
  isFetchingQuestion = false;
  renderEndlessQuiz();
}

async function getNextEndlessQuestion() {
  let safetyCounter = 0; // prevent infinite loops
  while(safetyCounter < 100) {
    safetyCounter++;
    
    if (endlessQuestionsBuffer.length > 0) {
      const q = endlessQuestionsBuffer.shift();
      const qKey = `${q.catSlug}|${q.pageNum}|${q.id}`;
      const isSolved = endlessProgress.solvedIds.includes(qKey);

      if (endlessMode === 'unsolved' && isSolved) continue;
      if (endlessMode === 'solved' && !isSolved) continue;
      
      q.key = qKey;
      return q;
    }

    if (endlessMode === 'solved') {
      if (endlessProgress.solvedIds.length === 0) {
        alert("You haven't solved any questions yet. Switching to normal mode.");
        endlessMode = 'normal';
        continue;
      }
      const randomKey = endlessProgress.solvedIds[Math.floor(Math.random() * endlessProgress.solvedIds.length)];
      const [slug, page] = randomKey.split('|');
      await fetchPageToBuffer(slug, parseInt(page));
    } else if (endlessMode === 'remix') {
      if (endlessProgress.solvedIds.length > 0 && Math.random() > 0.5) {
         const randomKey = endlessProgress.solvedIds[Math.floor(Math.random() * endlessProgress.solvedIds.length)];
         const [slug, page] = randomKey.split('|');
         await fetchPageToBuffer(slug, parseInt(page));
      } else {
         await fetchNextSequentialPage();
      }
    } else {
      await fetchNextSequentialPage();
    }
  }
  return null;
}

async function fetchNextSequentialPage() {
  const cat = catalogData.categories[endlessProgress.catIdx];
  if (!cat) { 
    // Loop back to start
    endlessProgress.catIdx = 0;
    endlessProgress.pageIdx = 1;
    saveEndlessProgress();
    return;
  }
  
  const success = await fetchPageToBuffer(cat.slug, endlessProgress.pageIdx);
  if (!success || endlessProgress.pageIdx >= cat.total_pages) {
    endlessProgress.catIdx++;
    endlessProgress.pageIdx = 1;
  } else {
    endlessProgress.pageIdx++;
  }
  saveEndlessProgress();
}

async function fetchPageToBuffer(slug, pageNum) {
  try {
    const pageStr = pageNum.toString().padStart(2, '0');
    const res = await fetch(`/data/quizbase/${slug}/page-${pageStr}.json`);
    if (!res.ok) return false;
    const data = await res.json();
    let questions = data.questions.map(q => ({...q, catSlug: slug, pageNum: pageNum}));
    
    // Shuffle for non-sequential modes
    if (endlessMode === 'remix' || endlessMode === 'solved') {
       questions.sort(() => Math.random() - 0.5);
    }
    endlessQuestionsBuffer.push(...questions);
    return true;
  } catch (e) {
    return false;
  }
}

function renderEndlessQuiz() {
  currentView = 'endless';
  
  const question = endlessHistory[endlessHistoryIndex];
  if (!question) {
    renderDashboard();
    return;
  }

  const isAnswered = endlessSessionAnswers[question.key] !== undefined;
  
  let html = `
    <div class="glass-panel fade-in">
      <div class="endless-menu">
         <button class="btn btn-outline ${endlessMode === 'normal' ? 'active' : ''}" data-mode="normal">Normal</button>
         <button class="btn btn-outline ${endlessMode === 'attempt_solved' ? 'active' : ''}" data-mode="attempt_solved">Attempt Solved</button>
         <button class="btn btn-outline ${endlessMode === 'attempt_unsolved' ? 'active' : ''}" data-mode="attempt_unsolved">Attempt Unsolved</button>
         <button class="btn btn-outline ${endlessMode === 'remix' ? 'active' : ''}" data-mode="remix">Remix</button>
         <button class="btn btn-outline" id="cleanStorageBtn" style="color: #ef4444; border-color: #ef4444;">Clean Storage</button>
         <button class="btn btn-outline" id="endlessExitBtn">Exit</button>
      </div>
      
      <div class="quiz-header">
        <div class="quiz-progress">
          Solved: ${endlessProgress.solvedIds.length} questions | Mode: ${endlessMode.replace('_', ' ').toUpperCase()}
        </div>
      </div>

      <div class="question-container">
        <p class="text-secondary" style="font-size: 0.875rem; margin-bottom: 0.5rem;">Category: ${question.catSlug.replace(/-/g, ' ')}</p>
        <h2 class="question-text">${question.question}</h2>
        <div class="options-grid">
  `;

  question.options.forEach(opt => {
    let classes = 'option-btn';
    let disabled = isAnswered ? 'disabled' : '';
    
    if (isAnswered) {
      if (opt.label === question.answer.label) {
        classes += ' correct';
      } else if (opt.label === endlessSessionAnswers[question.key]) {
        classes += ' incorrect';
      }
    }

    html += `
      <button class="${classes}" data-label="${opt.label}" ${disabled}>
        <span class="option-label">${opt.label}</span>
        <span>${opt.text}</span>
      </button>
    `;
  });

  html += `</div>`;

  if (isAnswered) {
    html += `
      <div class="explanation">
        <h4>
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Explanation
        </h4>
        <p>${question.explanation}</p>
      </div>
    `;
  }

  html += `
      <div class="quiz-nav">
        <button class="btn btn-outline" id="endlessPrevBtn" ${endlessHistoryIndex === 0 ? 'disabled' : ''}>
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Previous
        </button>
        <button class="btn btn-primary" id="endlessNextBtn" ${!isAnswered ? 'disabled' : ''}>
          Next Question
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
        </button>
      </div>
    </div>
  `;
  
  appDiv.innerHTML = html;

  // Event Listeners for Endless Quiz
  document.getElementById('endlessExitBtn')?.addEventListener('click', () => renderDashboard());
  
  document.getElementById('cleanStorageBtn')?.addEventListener('click', () => {
    if(confirm("Are you sure you want to clear your endless quiz progress?")) {
      endlessProgress = { solvedIds: [], catIdx: 0, pageIdx: 1 };
      saveEndlessProgress();
      renderEndlessQuiz();
    }
  });

  document.querySelectorAll('.endless-menu button[data-mode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      let selectedMode = e.target.dataset.mode;
      if (selectedMode === 'attempt_solved') selectedMode = 'solved';
      if (selectedMode === 'attempt_unsolved') selectedMode = 'unsolved';
      
      if (selectedMode !== endlessMode) {
        startEndlessQuiz(selectedMode);
      }
    });
  });

  if (!isAnswered) {
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedLabel = e.currentTarget.dataset.label;
        endlessSessionAnswers[question.key] = selectedLabel;
        
        if (!endlessProgress.solvedIds.includes(question.key)) {
          endlessProgress.solvedIds.push(question.key);
          saveEndlessProgress();
        }
        renderEndlessQuiz();
      });
    });
  }

  document.getElementById('endlessPrevBtn')?.addEventListener('click', () => advanceEndlessQuiz(-1));
  document.getElementById('endlessNextBtn')?.addEventListener('click', () => advanceEndlessQuiz(1));
}

// Start app
init();
