/**
 * PitchSource - Frontend JavaScript (Streaming Preview Version)
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

// State
let firms = [];
let issues = {};
let selectedIssues = [];
let completedMemoText = ''; // Store completed memo for results view

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

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadFirms();
  await loadIssues();
  setupEventListeners();
}

// Load firms for dropdown
async function loadFirms() {
  try {
    const response = await fetch(`${API_BASE}/api/firms`);
    const data = await response.json();
    firms = data.firms;
    
    // Populate dropdown
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
    
    // Populate dropdown (sorted alphabetically by label)
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
  // Demo scenario selection
  demoScenario.addEventListener('change', handleDemoScenario);
  
  // Firm selection
  firmSelect.addEventListener('change', handleFirmSelect);
  
  // Issue dropdown
  issueDropdown.addEventListener('change', handleIssueAdd);
  
  // Form submission
  pitchForm.addEventListener('submit', handleSubmit);
  
  // Results actions
  copyBtn.addEventListener('click', handleCopy);
  emailBtn.addEventListener('click', handleEmail);
  newMemoBtn.addEventListener('click', handleNewMemo);
  
  // See Results button
  seeResultsBtn.addEventListener('click', handleSeeResults);
}

// Handle demo scenario selection
function handleDemoScenario(e) {
  const scenarioKey = e.target.value;
  if (!scenarioKey) return;
  
  const scenario = DEMO_SCENARIOS[scenarioKey];
  if (!scenario) return;
  
  // Populate text fields
  document.getElementById('prospectName').value = scenario.prospectName;
  document.getElementById('prospectIndustry').value = scenario.prospectIndustry;
  document.getElementById('advocacyGoal').value = scenario.advocacyGoal;
  document.getElementById('goalType').value = scenario.goalType;
  document.getElementById('venue').value = scenario.venue;
  document.getElementById('timeline').value = scenario.timeline;
  document.getElementById('budgetRange').value = scenario.budgetRange;
  document.getElementById('additionalContext').value = scenario.additionalContext;
  
  // Clear existing issues and add scenario issues
  selectedIssues = [];
  renderIssueChips();
  
  scenario.issues.forEach(issueCode => {
    if (issues[issueCode] && !selectedIssues.includes(issueCode)) {
      selectedIssues.push(issueCode);
    }
  });
  
  renderIssueChips();
}

// Handle firm selection
function handleFirmSelect(e) {
  // Firm selected - no additional UI updates needed
}

// Handle issue add from dropdown
function handleIssueAdd(e) {
  const issueCode = e.target.value;
  
  if (issueCode && !selectedIssues.includes(issueCode)) {
    selectedIssues.push(issueCode);
    renderIssueChips();
  }
  
  // Reset dropdown to placeholder
  e.target.value = '';
}

// Handle issue removal
function handleIssueRemove(issueCode) {
  selectedIssues = selectedIssues.filter(code => code !== issueCode);
  renderIssueChips();
}

// Render issue chips
function renderIssueChips() {
  issueChips.innerHTML = '';
  
  selectedIssues.forEach(code => {
    const label = issues[code] || code;
    
    const chip = document.createElement('span');
    chip.className = 'issue-chip';
    chip.innerHTML = `
      ${escapeHtml(label)}
      <button type="button" class="issue-chip-remove" data-code="${code}" aria-label="Remove ${label}">×</button>
    `;
    
    // Add click handler for remove button
    chip.querySelector('.issue-chip-remove').addEventListener('click', () => {
      handleIssueRemove(code);
    });
    
    issueChips.appendChild(chip);
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle form submission - STREAMING VERSION
async function handleSubmit(e) {
  e.preventDefault();
  
  // Validate issues selected
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
    currentRepresentation: '', // Removed from UI but kept for API compatibility
    additionalContext: document.getElementById('additionalContext').value
  };
  
  // Hide input, show streaming preview
  hideError();
  inputSection.style.display = 'none';
  resultsSection.style.display = 'none';
  streamingSection.style.display = 'block';
  
  // Reset streaming state
  resetStreamingState(formData);
  
  try {
    const response = await fetch(`${API_BASE}/api/generate-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    // Check if response is streaming (SSE) or JSON error
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      // Non-streaming response (likely an error)
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate memo');
    }
    
    // Handle streaming response
    await handleStreamingResponse(response, formData);
    
  } catch (err) {
    console.error('Error generating memo:', err);
    showError(err.message || 'Failed to generate memo. Please try again.');
    // Return to input section on error
    streamingSection.style.display = 'none';
    inputSection.style.display = 'block';
  }
}

// Reset streaming preview state
function resetStreamingState(formData) {
  completedMemoText = '';
  streamingPreview.innerHTML = '';
  streamingFirm.textContent = formData.firmName;
  streamingProspect.textContent = formData.prospectName;
  statusDot.classList.remove('complete');
  statusText.textContent = 'Generating...';
  seeResultsBtn.disabled = true;
  seeResultsBtn.classList.remove('ready');
  seeResultsBtn.textContent = 'Generating memo...';
  streamingHint.textContent = 'Watching your pitch memo take shape';
}

// Handle streaming SSE response
async function handleStreamingResponse(response, formData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let memoText = '';
  let firmMeta = null;
  let prospectMeta = null;
  let buffer = ''; // Buffer for incomplete chunks
  
  while (true) {
    const { done, value } = await reader.read();
    
    if (done) {
      // Stream ended - mark complete if we have content
      if (memoText && !completedMemoText) {
        completedMemoText = memoText;
        handleStreamingComplete(formData, firmMeta, prospectMeta, null);
      }
      break;
    }
    
    // Add new data to buffer
    buffer += decoder.decode(value, { stream: true });
    
    // Process complete lines from buffer
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
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
            console.log(`Generating with model: ${data.model || 'unknown'}`);
            
          } else if (data.type === 'text') {
            memoText += data.content;
            streamingPreview.innerHTML = renderMemo(memoText) + '<span class="streaming-cursor"></span>';
            streamingPreview.scrollTop = streamingPreview.scrollHeight;
            
          } else if (data.type === 'done') {
            completedMemoText = memoText;
            handleStreamingComplete(formData, firmMeta, prospectMeta, data.memosRemaining);
            
          } else if (data.type === 'error') {
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
  // Remove cursor
  const cursor = streamingPreview.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();
  
  // Update status
  statusDot.classList.add('complete');
  statusText.textContent = 'Complete';
  
  // Enable button with animation
  seeResultsBtn.disabled = false;
  seeResultsBtn.classList.add('ready');
  seeResultsBtn.textContent = 'See Full Memo →';
  
  // Update hint
  if (memosRemaining !== null) {
    streamingHint.textContent = `Memo ready! (${memosRemaining} generations remaining)`;
  } else {
    streamingHint.textContent = 'Memo ready!';
  }
  
  // Store meta for results view
  seeResultsBtn.dataset.firmName = firmMeta?.name || formData.firmName;
  seeResultsBtn.dataset.prospectName = prospectMeta?.name || formData.prospectName;
}

// Handle "See Results" button click
function handleSeeResults() {
  // Populate results section
  memoFirm.textContent = seeResultsBtn.dataset.firmName;
  memoProspect.textContent = seeResultsBtn.dataset.prospectName;
  memoContent.innerHTML = renderMemo(completedMemoText);
  
  // Transition to results
  streamingSection.style.display = 'none';
  resultsSection.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Simple markdown renderer
function renderMemo(text) {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs
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

// Handle email - opens default mail client
function handleEmail() {
  const firmName = memoFirm.textContent;
  const prospectName = memoProspect.textContent;
  const memoText = memoContent.innerText;
  
  const subject = encodeURIComponent(`PitchSource Memo: ${firmName} → ${prospectName}`);
  const body = encodeURIComponent(memoText);
  
  // mailto has ~2000 char limit in some clients, but most modern ones handle more
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// Handle new memo
function handleNewMemo() {
  resultsSection.style.display = 'none';
  streamingSection.style.display = 'none';
  inputSection.style.display = 'block';
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
