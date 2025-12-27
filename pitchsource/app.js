/**
 * PitchSource - Frontend JavaScript (Agentic 3-Stage Workflow with Accordion UI)
 * Features:
 * - Accordion panels for each stage that expand/collapse
 * - Buffered streaming for consistent typing speed across all stages
 * - Distinct "prospect voice" styling for Stage 2 analysis
 */

// API Base URL - change to localhost:3001 for local testing
const API_BASE = 'https://pitchsource.vercel.app';

// Demo Scenarios
const DEMO_SCENARIOS = {
  ai: {
    prospectName: 'Frontier AI Systems',
    prospectIndustry: 'Artificial Intelligence / Technology',
    issues: ['SCI', 'CPI'],
    advocacyGoal: 'Ensure federal AI regulatory framework preempts state-level AI laws; seek inclusion in government AI infrastructure initiatives and federal contracting opportunities',
    goalType: 'offensive',
    venue: 'both',
    timeline: 'medium',
    budgetRange: '50k-100k',
    additionalContext: 'Company has 200 employees, $50M revenue, developing enterprise AI tools. Concerned about California and Colorado AI laws creating compliance burden.'
  },
  pharma: {
    prospectName: 'Meridian Therapeutics',
    prospectIndustry: 'Pharmaceuticals / Healthcare',
    issues: ['PHA', 'HCR', 'MMM'],
    advocacyGoal: 'Protect pipeline drugs from Medicare price negotiation by supporting orphan drug exemption legislation (ORPHAN Cures Act); oppose expansion of IRA negotiation program',
    goalType: 'defensive',
    venue: 'legislative',
    timeline: 'short',
    budgetRange: 'over100k',
    additionalContext: 'Mid-size specialty pharma with 3 drugs potentially subject to 2027 negotiation round. Two drugs have orphan designations for secondary indications.'
  },
  crypto: {
    prospectName: 'BlockSettle Inc.',
    prospectIndustry: 'Financial Technology / Cryptocurrency',
    issues: ['BAN', 'FIN'],
    advocacyGoal: 'Navigate GENIUS Act compliance requirements; engage with OCC and state regulators on licensing pathway for stablecoin issuance under $10B threshold',
    goalType: 'offensive',
    venue: 'regulatory',
    timeline: 'short',
    budgetRange: '25k-50k',
    additionalContext: 'Series B startup, $2B stablecoin market cap target. Need to establish relationships with OCC, state banking regulators, and key Hill offices on Financial Services committees.'
  },
  hospital: {
    prospectName: 'Mountain States Hospital Alliance',
    prospectIndustry: 'Healthcare / Hospitals',
    issues: ['HCR', 'MMM', 'BUD'],
    advocacyGoal: 'Oppose site-neutral payment policies that would cut Medicare reimbursements; protect 340B drug discount program eligibility',
    goalType: 'defensive',
    venue: 'both',
    timeline: 'urgent',
    budgetRange: 'under25k',
    additionalContext: 'Coalition of 12 rural hospitals across Montana, Wyoming, and Idaho. Several members at risk of closure if site-neutral policies enacted. 340B savings represent 8% of operating budget.'
  }
};

// =============================================================================
// DATA LAYER - Receives SSE events immediately, stores silently
// =============================================================================

// Stage data buckets - accumulate text as it arrives from server
const stageData = { 1: '', 2: '', 3: '', 4: '' };

// Stage completion flags - true when server says stage is done generating
const stageComplete = { 1: false, 2: false, 3: false, 4: false };

// Overall completion
let allDataReceived = false;
let doneEventData = null;

// Reset data layer for new generation
function resetDataLayer() {
  stageData[1] = '';
  stageData[2] = '';
  stageData[3] = '';
  stageData[4] = '';
  stageComplete[1] = false;
  stageComplete[2] = false;
  stageComplete[3] = false;
  stageComplete[4] = false;
  allDataReceived = false;
  doneEventData = null;
}

// =============================================================================
// DISPLAY LAYER - Reveals content on its own schedule
// =============================================================================

// Display configuration per stage
const DISPLAY_CONFIG = {
  1: { charsPerTick: 6,  tickInterval: 50, lingerMs: 800 },   // ~120 chars/sec
  2: { charsPerTick: 3,  tickInterval: 50, lingerMs: 2500 },  // ~60 chars/sec
  3: { charsPerTick: 3,  tickInterval: 50, lingerMs: 2500 },  // ~60 chars/sec (same as Stage 2)
  4: { charsPerTick: 15, tickInterval: 50, lingerMs: 0 },     // ~300 chars/sec (fast finish)
};

// Display state
let displayStage = 0;           // Which stage is currently being shown (0 = not started)
let displayedChars = 0;         // How many chars of current stage have been revealed
let isDisplaying = false;       // Is the display loop running?
let isLingeringAfterStage = false;  // Are we in a post-stage linger period?
let displayFormData = null;     // Stored for completion handler
let displayFirmMeta = null;
let displayProspectMeta = null;

// Start the display layer
function startDisplayLayer(formData, firmMeta, prospectMeta) {
  displayStage = 1;
  displayedChars = 0;
  isDisplaying = true;
  isLingeringAfterStage = false;
  displayFormData = formData;
  displayFirmMeta = firmMeta;
  displayProspectMeta = prospectMeta;
  
  // Initialize Stage 1 UI
  setAccordionStepActive(1);
  expandAccordionStep(1);
  statusText.textContent = 'Generating initial draft...';
  
  // Start the display tick loop
  scheduleDisplayTick();
}

// The main display tick - runs continuously until all stages are shown
function displayTick() {
  if (!isDisplaying || isLingeringAfterStage) return;
  
  const config = DISPLAY_CONFIG[displayStage];
  if (!config) return;
  
  const data = stageData[displayStage];
  const targetElement = getStageContentElement(displayStage);
  
  // Check if there's more content to reveal
  if (displayedChars < data.length) {
    // Drain some characters
    const endIndex = Math.min(displayedChars + config.charsPerTick, data.length);
    displayedChars = endIndex;
    
    // Render the revealed portion
    const revealedText = data.slice(0, displayedChars);
    if (targetElement) {
      targetElement.innerHTML = renderMemo(revealedText) + '<span class="streaming-cursor"></span>';
      targetElement.scrollTop = targetElement.scrollHeight;
    }
    
    // Schedule next tick
    scheduleDisplayTick();
    
  } else if (stageComplete[displayStage]) {
    // Current stage is fully revealed AND server marked it complete
    // Remove cursor and save text
    if (targetElement) {
      const cursor = targetElement.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
    }
    
    // Save to stage text variables
    if (displayStage === 1) stage1Text = data;
    if (displayStage === 2) stage2Text = data;
    if (displayStage === 3) stage3Text = data;
    if (displayStage === 4) stage4Text = data;
    
    // Start linger period
    isLingeringAfterStage = true;
    setTimeout(() => {
      finishStageAndAdvance();
    }, config.lingerMs);
    
  } else {
    // We've caught up to the data but stage isn't complete yet
    // Server is still generating - wait and check again
    scheduleDisplayTick();
  }
}

// Schedule the next display tick
function scheduleDisplayTick() {
  if (!isDisplaying) return;
  const config = DISPLAY_CONFIG[displayStage];
  const interval = config?.tickInterval || 50;
  setTimeout(displayTick, interval);
}

// Finish current stage and advance to next
function finishStageAndAdvance() {
  setAccordionStepComplete(displayStage);
  isLingeringAfterStage = false;
  
  if (displayStage < 4) {
    // Advance to next stage
    displayStage++;
    displayedChars = 0;
    
    // Update UI for new stage
    setAccordionStepActive(displayStage);
    expandAccordionStep(displayStage);
    
    const stageNames = {
      2: 'Analyzing from prospect perspective...',
      3: 'Planning revisions...',
      4: 'Finalizing memo...'
    };
    statusText.textContent = stageNames[displayStage] || 'Processing...';
    
    // Continue display loop
    scheduleDisplayTick();
    
  } else {
    // All 4 stages complete
    isDisplaying = false;
    completedMemoText = stage4Text || stage3Text || stage1Text;
    handleStreamingComplete(displayFormData, displayFirmMeta, displayProspectMeta, doneEventData?.memosRemaining);
  }
}

// Stop display (for errors)
function stopDisplayLayer() {
  isDisplaying = false;
  isLingeringAfterStage = false;
}

// =============================================================================
// STATE & DOM ELEMENTS
// =============================================================================

let firms = [];
let issues = {};
let selectedIssues = [];
let completedMemoText = '';
let currentStage = 0;
let stage1Text = '';
let stage2Text = '';
let stage3Text = '';
let stage4Text = '';
let prospectNameForReview = '';

// DOM Elements
const demoScenario = document.getElementById('demoScenario');
const firmSelect = document.getElementById('firmSelect');
const issueDropdown = document.getElementById('issueDropdown');
const issueChips = document.getElementById('issueChips');
const pitchForm = document.getElementById('pitchForm');
const generateBtn = document.getElementById('generateBtn');
const inputSection = document.getElementById('inputSection');
const streamingSection = document.getElementById('streamingSection');
const resultsSection = document.getElementById('resultsSection');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const memoContent = document.getElementById('memoContent');
const memoFirm = document.getElementById('memoFirm');
const memoProspect = document.getElementById('memoProspect');
const copyBtn = document.getElementById('copyBtn');
const emailBtn = document.getElementById('emailBtn');
const newMemoBtn = document.getElementById('newMemoBtn');

// Streaming-specific elements
const streamingPreview = document.getElementById('streamingPreview');
const streamingFirm = document.getElementById('streamingFirm');
const streamingProspect = document.getElementById('streamingProspect');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const seeResultsBtn = document.getElementById('seeResultsBtn');
const streamingHint = document.getElementById('streamingHint');

// Accordion elements
const accordionSteps = document.getElementById('accordionSteps');
const stage1Content = document.getElementById('stage1Content');
const stage2Content = document.getElementById('stage2Content');
const stage3Content = document.getElementById('stage3Content');
const stage4Content = document.getElementById('stage4Content');
const prospectReviewName = document.getElementById('prospectReviewName');

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadFirms();
  await loadIssues();
  setupEventListeners();
  setupAccordionClickHandlers();
}

// Load firms for dropdown
async function loadFirms() {
  try {
    const response = await fetch(`${API_BASE}/api/firms`);
    const data = await response.json();
    firms = data.firms;
    
    firms.forEach(firm => {
      const option = document.createElement('option');
      option.value = firm.name;
      option.textContent = firm.name;
      firmSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Error loading firms:', err);
    showError('Failed to load firm list. Please refresh the page.');
  }
}

// Load issue codes
async function loadIssues() {
  try {
    const response = await fetch(`${API_BASE}/api/issues`);
    const data = await response.json();
    issues = data.issues;
    
    const sortedIssues = Object.entries(issues).sort((a, b) => a[1].localeCompare(b[1]));
    sortedIssues.forEach(([code, label]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = label;
      issueDropdown.appendChild(option);
    });
  } catch (err) {
    console.error('Error loading issues:', err);
  }
}

// Setup event listeners
function setupEventListeners() {
  demoScenario.addEventListener('change', handleDemoScenario);
  firmSelect.addEventListener('change', handleFirmSelect);
  issueDropdown.addEventListener('change', handleIssueAdd);
  pitchForm.addEventListener('submit', handleSubmit);
  copyBtn.addEventListener('click', handleCopy);
  emailBtn.addEventListener('click', handleEmail);
  newMemoBtn.addEventListener('click', handleNewMemo);
  seeResultsBtn.addEventListener('click', handleSeeResults);
}

// Setup accordion click handlers for manual expand/collapse after completion
function setupAccordionClickHandlers() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      // Only allow manual toggling after generation is complete
      if (!statusDot.classList.contains('complete')) return;
      
      const step = header.closest('.accordion-step');
      step.classList.toggle('expanded');
    });
  });
}

// =============================================================================
// ACCORDION MANAGEMENT
// =============================================================================

// Reset all accordion steps to initial state
function resetAccordion() {
  document.querySelectorAll('.accordion-step').forEach(step => {
    step.classList.remove('active', 'complete', 'expanded');
  });
  stage1Content.innerHTML = '';
  stage2Content.innerHTML = '';
  stage3Content.innerHTML = '';
  if (stage4Content) stage4Content.innerHTML = '';
  stage1Text = '';
  stage2Text = '';
  stage3Text = '';
  stage4Text = '';
}

// Expand a specific accordion step (and collapse others during streaming)
function expandAccordionStep(stepNum, collapseOthers = true) {
  document.querySelectorAll('.accordion-step').forEach((step, index) => {
    const thisStepNum = index + 1;
    if (thisStepNum === stepNum) {
      step.classList.add('expanded');
    } else if (collapseOthers) {
      step.classList.remove('expanded');
    }
  });
}

// Mark accordion step as active
function setAccordionStepActive(stepNum) {
  document.querySelectorAll('.accordion-step').forEach((step, index) => {
    const thisStepNum = index + 1;
    if (thisStepNum === stepNum) {
      step.classList.add('active');
      step.classList.remove('complete');
    } else if (thisStepNum < stepNum) {
      step.classList.remove('active');
      step.classList.add('complete');
    } else {
      step.classList.remove('active', 'complete');
    }
  });
}

// Mark accordion step as complete
function setAccordionStepComplete(stepNum) {
  const step = document.querySelector(`.accordion-step[data-step="${stepNum}"]`);
  if (step) {
    step.classList.remove('active');
    step.classList.add('complete');
  }
}

// Get content element for a stage
function getStageContentElement(stage) {
  switch (stage) {
    case 1: return stage1Content;
    case 2: return stage2Content;
    case 3: return stage3Content;
    case 4: return stage4Content;
    default: return null;
  }
}

// =============================================================================
// DEMO SCENARIO & FORM HANDLING
// =============================================================================

function handleDemoScenario(e) {
  const scenarioKey = e.target.value;
  if (!scenarioKey) return;
  
  const scenario = DEMO_SCENARIOS[scenarioKey];
  if (!scenario) return;
  
  document.getElementById('prospectName').value = scenario.prospectName;
  document.getElementById('prospectIndustry').value = scenario.prospectIndustry;
  document.getElementById('advocacyGoal').value = scenario.advocacyGoal;
  document.getElementById('goalType').value = scenario.goalType;
  document.getElementById('venue').value = scenario.venue;
  document.getElementById('timeline').value = scenario.timeline;
  document.getElementById('budgetRange').value = scenario.budgetRange;
  document.getElementById('additionalContext').value = scenario.additionalContext;
  
  selectedIssues = [];
  renderIssueChips();
  
  scenario.issues.forEach(issueCode => {
    if (issues[issueCode] && !selectedIssues.includes(issueCode)) {
      selectedIssues.push(issueCode);
    }
  });
  
  renderIssueChips();
}

function handleFirmSelect(e) {
  // Firm selected - no additional UI updates needed
}

function handleIssueAdd(e) {
  const issueCode = e.target.value;
  
  if (issueCode && !selectedIssues.includes(issueCode)) {
    selectedIssues.push(issueCode);
    renderIssueChips();
  }
  
  e.target.value = '';
}

function handleIssueRemove(issueCode) {
  selectedIssues = selectedIssues.filter(code => code !== issueCode);
  renderIssueChips();
}

function renderIssueChips() {
  issueChips.innerHTML = '';
  
  selectedIssues.forEach(code => {
    const label = issues[code] || code;
    
    const chip = document.createElement('span');
    chip.className = 'issue-chip';
    chip.innerHTML = `
      ${label}
      <button type="button" class="chip-remove" data-code="${code}">&times;</button>
    `;
    
    chip.querySelector('.chip-remove').addEventListener('click', () => {
      handleIssueRemove(code);
    });
    
    issueChips.appendChild(chip);
  });
}

// =============================================================================
// FORM SUBMISSION & STREAMING
// =============================================================================

async function handleSubmit(e) {
  e.preventDefault();
  hideError();
  
  // Validate
  if (selectedIssues.length === 0) {
    showError('Please select at least one issue area.');
    return;
  }
  
  // Get form data
  const formData = {
    firmName: firmSelect.value,
    prospectName: document.getElementById('prospectName').value,
    prospectIndustry: document.getElementById('prospectIndustry').value,
    prospectIssues: selectedIssues,
    advocacyGoal: document.getElementById('advocacyGoal').value,
    goalType: document.getElementById('goalType').value,
    venue: document.getElementById('venue').value,
    timeline: document.getElementById('timeline').value,
    budgetRange: document.getElementById('budgetRange').value,
    currentRepresentation: '',
    additionalContext: document.getElementById('additionalContext').value,
    agenticMode: document.getElementById('agenticToggle').checked
  };
  
  // Store prospect name for Stage 2 display
  prospectNameForReview = formData.prospectName;
  
  // Show loading state
  generateBtn.querySelector('.btn-text').style.display = 'none';
  generateBtn.querySelector('.btn-loading').style.display = 'inline-flex';
  generateBtn.disabled = true;
  
  // Reset and show streaming section
  resetStreamingState(formData);
  inputSection.style.display = 'none';
  streamingSection.style.display = 'block';
  
  // Collapse header to just logo + red line during streaming
  const header = document.querySelector('.header');
  if (header) header.classList.add('collapsed');
  
  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  try {
    const response = await fetch(`${API_BASE}/api/generate-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate memo');
    }
    
    await handleStreamingResponse(response, formData);
    
  } catch (err) {
    console.error('Error:', err);
    stopDisplayLayer();
    showError(err.message);
    inputSection.style.display = 'block';
    streamingSection.style.display = 'none';
    // Restore header
    const header = document.querySelector('.header');
    if (header) header.classList.remove('collapsed');
  } finally {
    generateBtn.querySelector('.btn-text').style.display = 'inline';
    generateBtn.querySelector('.btn-loading').style.display = 'none';
    generateBtn.disabled = false;
  }
}

// Reset streaming preview state
function resetStreamingState(formData) {
  completedMemoText = '';
  currentStage = 0;
  stage1Text = '';
  stage2Text = '';
  stage3Text = '';
  stage4Text = '';
  
  // Reset data layer
  resetDataLayer();
  
  // Reset display layer
  displayStage = 0;
  displayedChars = 0;
  isDisplaying = false;
  isLingeringAfterStage = false;
  displayFormData = null;
  displayFirmMeta = null;
  displayProspectMeta = null;
  
  streamingFirm.textContent = formData.firmName;
  streamingProspect.textContent = formData.prospectName;
  statusDot.classList.remove('complete');
  statusText.textContent = formData.agenticMode ? 'Starting...' : 'Generating...';
  seeResultsBtn.disabled = true;
  seeResultsBtn.classList.remove('ready');
  seeResultsBtn.textContent = 'Generating memo...';
  streamingHint.textContent = 'Watching your pitch memo take shape';
  
  // Show/hide appropriate UI based on agentic mode
  if (formData.agenticMode) {
    accordionSteps.style.display = 'flex';
    streamingPreview.style.display = 'none';
    resetAccordion();
    // Update prospect name in Stage 2 header
    if (prospectReviewName) {
      prospectReviewName.textContent = formData.prospectName;
    }
  } else {
    accordionSteps.style.display = 'none';
    streamingPreview.style.display = 'block';
    streamingPreview.innerHTML = '';
  }
}

// Handle streaming SSE response - Data layer receives, Display layer reveals
async function handleStreamingResponse(response, formData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let firmMeta = null;
  let prospectMeta = null;
  let sseBuffer = '';
  const isAgentic = formData.agenticMode;
  
  // Reset data layer
  resetDataLayer();
  
  // Track which stage server is currently sending (for data layer)
  let serverStage = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    
    if (done) {
      // Stream ended unexpectedly - try to recover
      if (!allDataReceived) {
        console.warn('Stream ended without done event');
        allDataReceived = true;
        // Mark current stage complete if not already
        if (serverStage > 0 && !stageComplete[serverStage]) {
          stageComplete[serverStage] = true;
        }
      }
      break;
    }
    
    sseBuffer += decoder.decode(value, { stream: true });
    
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        
        try {
          const data = JSON.parse(dataStr);
          
          if (data.type === 'meta') {
            firmMeta = data.firm;
            prospectMeta = data.prospect;
            streamingFirm.textContent = firmMeta?.name || formData.firmName;
            streamingProspect.textContent = prospectMeta?.name || formData.prospectName;
            if (prospectReviewName && prospectMeta?.name) {
              prospectReviewName.textContent = prospectMeta.name;
            }
            console.log(`Mode: ${data.model || 'unknown'}`);
            
          } else if (data.type === 'stage' && isAgentic) {
            if (data.status === 'starting') {
              serverStage = data.stage;
              console.log(`[DATA] Stage ${serverStage} starting`);
              
              // Start display layer on first stage
              if (serverStage === 1 && displayStage === 0) {
                startDisplayLayer(formData, firmMeta, prospectMeta);
              }
              
            } else if (data.status === 'complete') {
              stageComplete[data.stage] = true;
              console.log(`[DATA] Stage ${data.stage} complete (${stageData[data.stage].length} chars)`);
            }
            
          } else if (data.type === 'text') {
            if (isAgentic && serverStage > 0) {
              // Simply append to the appropriate stage bucket
              stageData[serverStage] += data.content;
            } else if (!isAgentic) {
              // Non-agentic mode: direct render (unchanged behavior)
              stage1Text += data.content;
              streamingPreview.innerHTML = renderMemo(stage1Text) + '<span class="streaming-cursor"></span>';
              streamingPreview.scrollTop = streamingPreview.scrollHeight;
            }
            
          } else if (data.type === 'done') {
            allDataReceived = true;
            doneEventData = data;
            console.log('[DATA] All data received from server');
            // Display layer will handle completion when it catches up
            
          } else if (data.type === 'error') {
            stopDisplayLayer();
            throw new Error(data.message);
          }
          
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            console.warn('Skipping malformed SSE chunk:', dataStr);
            continue;
          }
          throw parseErr;
        }
      }
    }
  }
}

// Handle streaming completion
function handleStreamingComplete(formData, firmMeta, prospectMeta, memosRemaining) {
  // Remove any remaining cursors
  document.querySelectorAll('.streaming-cursor').forEach(c => c.remove());
  
  // Mark all steps complete (agentic mode only)
  if (formData.agenticMode) {
    document.querySelectorAll('.accordion-step').forEach(step => {
      step.classList.remove('active');
      step.classList.add('complete');
    });
    // Expand Stage 4 to show final result
    expandAccordionStep(4, false);
  }
  
  // Restore header (was collapsed during streaming)
  const header = document.querySelector('.header');
  if (header) header.classList.remove('collapsed');
  
  // Update status
  statusDot.classList.add('complete');
  statusText.textContent = 'Complete';
  
  // Enable button
  seeResultsBtn.disabled = false;
  seeResultsBtn.classList.add('ready');
  seeResultsBtn.textContent = 'See Full Memo →';
  
  // Update hint
  if (memosRemaining !== null) {
    streamingHint.textContent = `Memo ready! (${memosRemaining} generations remaining)`;
  } else {
    streamingHint.textContent = 'Memo ready!';
  }
  
  // Store meta
  seeResultsBtn.dataset.firmName = firmMeta?.name || formData.firmName;
  seeResultsBtn.dataset.prospectName = prospectMeta?.name || formData.prospectName;
}

// =============================================================================
// RESULTS HANDLING
// =============================================================================

function handleSeeResults() {
  memoFirm.textContent = seeResultsBtn.dataset.firmName;
  memoProspect.textContent = seeResultsBtn.dataset.prospectName;
  memoContent.innerHTML = renderMemo(completedMemoText);
  
  streamingSection.style.display = 'none';
  resultsSection.style.display = 'block';
  
  // Keep header collapsed on results page
  const header = document.querySelector('.header');
  if (header) header.classList.add('collapsed');
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Simple markdown renderer
function renderMemo(text) {
  return text
    .replace(/^([A-Z][A-Z\s&\-]+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return match;
    });
}

// Handle copy to clipboard
async function handleCopy() {
  const text = memoContent.innerText;
  
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy to Clipboard';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// Handle email
function handleEmail() {
  const firmName = memoFirm.textContent;
  const prospectName = memoProspect.textContent;
  const memoText = memoContent.innerText;
  
  const subject = encodeURIComponent(`PitchSource Memo: ${firmName} → ${prospectName}`);
  const body = encodeURIComponent(memoText);
  
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// Handle new memo
function handleNewMemo() {
  resultsSection.style.display = 'none';
  streamingSection.style.display = 'none';
  inputSection.style.display = 'block';
  
  // Restore full header on input page
  const header = document.querySelector('.header');
  if (header) header.classList.remove('collapsed');
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Error handling
function showError(message) {
  errorText.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}
