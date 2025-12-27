/**
 * PitchSource - Frontend JavaScript (Three-Mode System with Intervention)
 * 
 * Modes:
 * - Draft: Single-stage generation, no streaming
 * - Standard: Full 4-stage workflow, background processing, no streaming
 * - Detailed: Full 4-stage workflow with streaming & intervention after Stage 3
 * 
 * Features:
 * - Accordion panels for each stage that expand/collapse
 * - Buffered streaming for consistent typing speed (Detailed mode)
 * - Intervention panel for accept/reject revisions (Detailed mode)
 * - Distinct "prospect voice" styling for Stage 2 analysis
 */

// API Base URL - change to localhost:3001 for local testing
const API_BASE = 'https://pitchsource.vercel.app';

// Mode descriptions for UI
const MODE_DESCRIPTIONS = {
  draft: 'Single-stage generation. Fastest and most economical.',
  standard: 'Full agentic workflow running in background. Results appear when complete.',
  detailed: 'Watch the process unfold. Review and approve revisions before finalizing.'
};

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

// Intervention state (Detailed mode only)
let isWaitingForIntervention = false;  // Paused at Stage 3, waiting for user decision
let interventionDecision = null;       // 'accept' or 'reject'

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
    
    // Update stage progress bar based on displayed chars (not received chars)
    updateStageProgressBar(displayStage, displayedChars);
    
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
  
  const mode = displayFormData?.generationMode || 'detailed';
  
  if (displayStage < 4) {
    if (mode === 'detailed') {
      // Detailed mode: pause after each stage for user review
      isDisplaying = false;
      
      if (displayStage === 3) {
        // After Stage 3: show intervention panel (accept/reject revisions)
        isWaitingForIntervention = true;
        showInterventionPanel();
      } else {
        // After Stages 1 and 2: show continue panel
        showContinuePanel(displayStage);
      }
      return;
    }
    
    // Standard mode falls through (shouldn't reach here as Standard doesn't use display layer)
    advanceToNextStage();
    
  } else {
    // All 4 stages complete
    isDisplaying = false;
    completedMemoText = stage4Text || stage3Text || stage1Text;
    handleStreamingComplete(displayFormData, displayFirmMeta, displayProspectMeta, doneEventData?.memosRemaining);
  }
}

// Advance to the next stage (used by continue handlers)
function advanceToNextStage() {
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
  isDisplaying = true;
  scheduleDisplayTick();
}

// Show continue panel (Detailed mode - after Stages 1, 2)
function showContinuePanel(completedStage) {
  const stageLabels = {
    1: 'Initial Draft complete',
    2: 'Prospect Analysis complete'
  };
  const stageDescriptions = {
    1: 'Review the draft above, then continue to prospect analysis.',
    2: 'Review the feedback above, then continue to revision planning.'
  };
  
  if (continueStageLabel) {
    continueStageLabel.textContent = stageLabels[completedStage] || `Stage ${completedStage} complete`;
  }
  if (continueDescription) {
    continueDescription.textContent = stageDescriptions[completedStage] || 'Review the output above, then continue.';
  }
  if (continuePanel) {
    // Move panel to appear right after the completed stage's content (inside the accordion-step)
    const completedStep = document.querySelector(`.accordion-step[data-step="${completedStage}"]`);
    if (completedStep) {
      // Insert inside the accordion-step, after the accordion-panel
      const accordionPanel = completedStep.querySelector('.accordion-panel');
      if (accordionPanel) {
        accordionPanel.insertAdjacentElement('afterend', continuePanel);
      } else {
        completedStep.appendChild(continuePanel);
      }
    }
    continuePanel.style.display = 'flex';
    // Scroll gently - only if needed, keep stage header visible
    continuePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  statusText.textContent = 'Review and continue...';
}

// Hide continue panel
function hideContinuePanel() {
  if (continuePanel) {
    continuePanel.style.display = 'none';
  }
}

// Handle continue button click
function handleContinue() {
  hideContinuePanel();
  advanceToNextStage();
}

// Show intervention panel (Detailed mode)
function showInterventionPanel() {
  const panel = document.getElementById('interventionPanel');
  if (panel) {
    // Move panel to appear right after Stage 3's content (inside the accordion-step)
    const stage3Step = document.querySelector('.accordion-step[data-step="3"]');
    if (stage3Step) {
      const accordionPanel = stage3Step.querySelector('.accordion-panel');
      if (accordionPanel) {
        accordionPanel.insertAdjacentElement('afterend', panel);
      } else {
        stage3Step.appendChild(panel);
      }
    }
    panel.style.display = 'block';
    // Scroll gently - only if needed
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  statusText.textContent = 'Review revisions...';
}

// Hide intervention panel
function hideInterventionPanel() {
  const panel = document.getElementById('interventionPanel');
  if (panel) {
    panel.style.display = 'none';
  }
}

// Handle accept revisions
function handleAcceptRevisions() {
  interventionDecision = 'accept';
  isWaitingForIntervention = false;
  hideInterventionPanel();
  
  // Continue to Stage 4
  displayStage = 4;
  displayedChars = 0;
  isDisplaying = true;
  
  setAccordionStepActive(4);
  expandAccordionStep(4);
  statusText.textContent = 'Finalizing memo...';
  
  scheduleDisplayTick();
}

// Handle keep original
function handleKeepOriginal() {
  interventionDecision = 'reject';
  isWaitingForIntervention = false;
  hideInterventionPanel();
  
  // Skip Stage 4, use Stage 1 output as final
  isDisplaying = false;
  completedMemoText = stage1Text;
  
  // Mark Stage 4 as skipped visually
  const stage4Step = document.querySelector('.accordion-step[data-step="4"]');
  if (stage4Step) {
    stage4Step.classList.add('skipped');
  }
  
  handleStreamingComplete(displayFormData, displayFirmMeta, displayProspectMeta, doneEventData?.memosRemaining);
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
let lastGenerationMode = 'detailed';

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
const downloadReportBtn = document.getElementById('downloadReportBtn');

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

// Mode selector elements
const generationMode = document.getElementById('generationMode');
const modeDescription = document.getElementById('modeDescription');

// Intervention panel elements
const interventionPanel = document.getElementById('interventionPanel');
const interventionSummary = document.getElementById('interventionSummary');
const acceptRevisionsBtn = document.getElementById('acceptRevisionsBtn');
const keepOriginalBtn = document.getElementById('keepOriginalBtn');

// Continue panel elements
const continuePanel = document.getElementById('continuePanel');
const continueStageLabel = document.getElementById('continueStageLabel');
const continueDescription = document.getElementById('continueDescription');
const continueBtn = document.getElementById('continueBtn');

// Progress bar elements
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');

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
  
  // Download Report button
  if (downloadReportBtn) {
    downloadReportBtn.addEventListener('click', handleDownloadReport);
  }
  
  // Mode selector
  if (generationMode) {
    generationMode.addEventListener('change', handleModeChange);
  }
  
  // Intervention buttons
  if (acceptRevisionsBtn) {
    acceptRevisionsBtn.addEventListener('click', handleAcceptRevisions);
  }
  if (keepOriginalBtn) {
    keepOriginalBtn.addEventListener('click', handleKeepOriginal);
  }
  
  // Continue button (Detailed mode)
  if (continueBtn) {
    continueBtn.addEventListener('click', handleContinue);
  }
}

// Handle mode selector change
function handleModeChange(e) {
  const mode = e.target.value;
  if (modeDescription && MODE_DESCRIPTIONS[mode]) {
    modeDescription.textContent = MODE_DESCRIPTIONS[mode];
  }
}

// Setup accordion click handlers for manual expand/collapse after completion
function setupAccordionClickHandlers() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const step = header.closest('.accordion-step');
      
      // Allow toggling if:
      // 1. Generation is fully complete, OR
      // 2. This specific step is complete (Standard mode - view completed stages mid-generation)
      const generationComplete = statusDot.classList.contains('complete');
      const stepComplete = step.classList.contains('complete');
      
      if (!generationComplete && !stepComplete) return;
      
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
    step.classList.remove('active', 'complete', 'expanded', 'skipped', 'background-mode');
  });
  stage1Content.innerHTML = '';
  stage2Content.innerHTML = '';
  stage3Content.innerHTML = '';
  if (stage4Content) stage4Content.innerHTML = '';
  stage1Text = '';
  stage2Text = '';
  stage3Text = '';
  stage4Text = '';
  resetStageProgressBars();
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
  // Update progress bar (stage starting)
  updateProgressBar(stepNum, false);
}

// Mark accordion step as complete
function setAccordionStepComplete(stepNum) {
  const step = document.querySelector(`.accordion-step[data-step="${stepNum}"]`);
  if (step) {
    step.classList.remove('active');
    step.classList.add('complete');
  }
  // Update overall progress bar
  updateProgressBar(stepNum, true);
  // Set stage progress bar to 100%
  const stageProgressBar = document.getElementById(`stageProgress${stepNum}`);
  if (stageProgressBar) {
    const fill = stageProgressBar.querySelector('.stage-progress-fill');
    if (fill) fill.style.width = '100%';
  }
}

// Update progress bar
function updateProgressBar(stage, isComplete = false) {
  if (!progressContainer || progressContainer.style.display === 'none') return;
  
  // Progress: each complete stage = 25%, active stage = partial
  let percent;
  if (isComplete) {
    percent = stage * 25;
    progressLabel.textContent = stage < 4 ? `Stage ${stage} of 4 complete` : 'Complete';
  } else {
    percent = ((stage - 1) * 25) + 5; // 5% into current stage
    progressLabel.textContent = `Stage ${stage} of 4`;
  }
  
  progressFill.style.width = `${percent}%`;
}

// Show progress bar (for Standard/Detailed modes)
function showProgressBar() {
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Starting...';
  }
}

// Hide progress bar (for Draft mode)
function hideProgressBar() {
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }
}

// Expected characters per stage (for progress estimation)
const STAGE_EXPECTED_CHARS = {
  1: 6000,  // Full memo draft
  2: 2000,  // Prospect analysis
  3: 1000,  // Revision plan
  4: 6000   // Final memo
};

// Update individual stage progress bar
function updateStageProgressBar(stage, currentChars) {
  const progressBar = document.getElementById(`stageProgress${stage}`);
  if (!progressBar) return;
  
  const fill = progressBar.querySelector('.stage-progress-fill');
  if (!fill) return;
  
  const expected = STAGE_EXPECTED_CHARS[stage] || 3000;
  // Cap at 95% until stage is marked complete
  const percent = Math.min(95, (currentChars / expected) * 100);
  fill.style.width = `${percent}%`;
}

// Reset all stage progress bars
function resetStageProgressBars() {
  for (let i = 1; i <= 4; i++) {
    const progressBar = document.getElementById(`stageProgress${i}`);
    if (progressBar) {
      const fill = progressBar.querySelector('.stage-progress-fill');
      if (fill) fill.style.width = '0%';
    }
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
  const selectedMode = document.getElementById('generationMode')?.value || 'detailed';
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
    generationMode: selectedMode,
    // For backend compatibility: agentic = true for standard/detailed, false for draft
    agenticMode: selectedMode !== 'draft'
  };
  
  // Store prospect name for Stage 2 display
  prospectNameForReview = formData.prospectName;
  
  // Store generation mode for report download
  lastGenerationMode = selectedMode;
  
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
  
  // Reset intervention state
  isWaitingForIntervention = false;
  interventionDecision = null;
  hideInterventionPanel();
  hideContinuePanel();
  
  streamingFirm.textContent = formData.firmName;
  streamingProspect.textContent = formData.prospectName;
  statusDot.classList.remove('complete');
  seeResultsBtn.disabled = true;
  seeResultsBtn.classList.remove('ready');
  seeResultsBtn.textContent = 'Generating memo...';
  
  const mode = formData.generationMode || 'detailed';
  
  // Mode-specific UI setup
  if (mode === 'draft') {
    // Draft: single stage, simple preview, no accordion
    statusText.textContent = 'Generating draft...';
    streamingHint.textContent = 'Creating your pitch memo';
    accordionSteps.style.display = 'none';
    streamingPreview.style.display = 'block';
    streamingPreview.innerHTML = '<div class="draft-loading"><span class="spinner"></span> Generating single-stage draft...</div>';
    hideProgressBar();
  } else if (mode === 'standard') {
    // Standard: full workflow, show accordions - content populates when each stage completes
    statusText.textContent = 'Processing...';
    streamingHint.textContent = 'Running full analysis. Click stages to review when complete.';
    accordionSteps.style.display = 'flex';
    streamingPreview.style.display = 'none';
    resetAccordion();
    showProgressBar();
    if (prospectReviewName) {
      prospectReviewName.textContent = formData.prospectName;
    }
  } else {
    // Detailed: full workflow with streaming and manual continue after each stage
    statusText.textContent = 'Starting...';
    streamingHint.textContent = 'Watching your pitch memo take shape';
    accordionSteps.style.display = 'flex';
    streamingPreview.style.display = 'none';
    resetAccordion();
    showProgressBar();
    if (prospectReviewName) {
      prospectReviewName.textContent = formData.prospectName;
    }
  }
}

// Handle streaming SSE response - Data layer receives, Display layer reveals
async function handleStreamingResponse(response, formData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let firmMeta = null;
  let prospectMeta = null;
  let sseBuffer = '';
  const mode = formData.generationMode || 'detailed';
  const isAgentic = formData.agenticMode; // true for standard/detailed, false for draft
  
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
            console.log(`Mode: ${data.model || 'unknown'}, Generation Mode: ${mode}`);
            
          } else if (data.type === 'stage' && isAgentic) {
            if (data.status === 'starting') {
              serverStage = data.stage;
              console.log(`[DATA] Stage ${serverStage} starting`);
              
              if (mode === 'detailed') {
                // Detailed mode: start display layer on first stage
                if (serverStage === 1 && displayStage === 0) {
                  startDisplayLayer(formData, firmMeta, prospectMeta);
                }
              } else if (mode === 'standard') {
                // Standard mode: update stage indicators without streaming
                setAccordionStepActive(serverStage);
                const stageNames = {
                  1: 'Generating initial draft...',
                  2: 'Analyzing from prospect perspective...',
                  3: 'Planning revisions...',
                  4: 'Finalizing memo...'
                };
                statusText.textContent = stageNames[serverStage] || 'Processing...';
              }
              
            } else if (data.status === 'complete') {
              stageComplete[data.stage] = true;
              console.log(`[DATA] Stage ${data.stage} complete (${stageData[data.stage].length} chars)`);
              
              if (mode === 'standard') {
                // Standard mode: render completed content and mark stage complete
                const targetElement = getStageContentElement(data.stage);
                if (targetElement && stageData[data.stage]) {
                  targetElement.innerHTML = renderMemo(stageData[data.stage]);
                }
                setAccordionStepComplete(data.stage);
              }
            }
            
          } else if (data.type === 'text') {
            // Use stage from text event if available, else fall back to serverStage
            const textStage = data.stage || serverStage;
            
            if (isAgentic && textStage > 0) {
              // Agentic modes: append to stage bucket
              stageData[textStage] += data.content;
              
              // Update stage progress bar (Standard mode only - Detailed uses display layer)
              if (mode === 'standard') {
                updateStageProgressBar(textStage, stageData[textStage].length);
              }
              
              // For detailed mode, the display layer handles rendering and progress
              // For standard mode, we just collect silently
              
            } else if (!isAgentic) {
              // Draft mode: direct render to preview
              stage1Text += data.content;
              streamingPreview.innerHTML = renderMemo(stage1Text) + '<span class="streaming-cursor"></span>';
              streamingPreview.scrollTop = streamingPreview.scrollHeight;
            }
            
          } else if (data.type === 'done') {
            allDataReceived = true;
            doneEventData = data;
            console.log('[DATA] All data received from server');
            
            if (mode === 'draft') {
              // Draft mode: complete immediately
              completedMemoText = stage1Text;
              handleStreamingComplete(formData, firmMeta, prospectMeta, data.memosRemaining);
            } else if (mode === 'standard') {
              // Standard mode: complete immediately with Stage 4 output
              stage1Text = stageData[1];
              stage4Text = stageData[4];
              completedMemoText = stage4Text || stageData[3] || stageData[1];
              handleStreamingComplete(formData, firmMeta, prospectMeta, data.memosRemaining);
            }
            // Detailed mode: display layer will handle completion when it catches up
            
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

// Download workflow report
function handleDownloadReport() {
  const firmName = memoFirm?.textContent || 'Unknown Firm';
  const prospectName = memoProspect?.textContent || 'Unknown Prospect';
  const timestamp = new Date().toLocaleString();
  const mode = lastGenerationMode || 'unknown';
  
  // Build markdown report
  let report = `# PitchSource Workflow Report

**Generated:** ${timestamp}  
**Firm:** ${firmName}  
**Prospect:** ${prospectName}  
**Generation Mode:** ${mode}

---

`;

  // Check if we have multi-stage data (Standard/Detailed modes)
  const hasMultiStage = stage2Text || stageData[2];
  
  if (hasMultiStage) {
    // Full agentic workflow report
    report += `## Stage 1: Initial Draft
*AI generates strategic pitch memo using firm data and 50 evidence-based advocacy principles*

${stage1Text || stageData[1] || '[No content captured]'}

---

## Stage 2: Prospect Analysis
*AI critiques the memo from the prospect's perspective, identifying gaps and concerns*

${stage2Text || stageData[2] || '[No content captured]'}

---

## Stage 3: Revision Plan
*AI plans how to address the prospect's feedback*

${stage3Text || stageData[3] || '[No content captured]'}

---

## Stage 4: Final Memo
*AI executes the revision plan to produce the refined pitch memo*

${stage4Text || stageData[4] || completedMemoText || '[No content captured]'}

---

`;
  } else {
    // Single-stage (Draft mode) report
    report += `## Generated Memo
*Single-stage generation without revision process*

${completedMemoText || stage1Text || '[No content captured]'}

---

`;
  }

  report += `## Report Metadata

- **Tool:** PitchSource by mikeburns.ai
- **Data Source:** Public LDA filings (Senate Lobbying Disclosure Act)
- **AI Model:** Claude (Anthropic)
- **Workflow:** ${hasMultiStage ? '4-stage agentic (Draft → Critique → Plan → Revise)' : 'Single-stage generation'}

*This report is for internal review purposes. The final memo should be reviewed and customized before client use.*
`;

  // Create and download file
  const blob = new Blob([report], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PitchSource-Report-${firmName.replace(/[^a-z0-9]/gi, '-')}-${prospectName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Error handling
function showError(message) {
  errorText.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError() {
  errorMessage.style.display = 'none';
}
