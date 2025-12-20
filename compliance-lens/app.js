import POLICY_TEMPLATES from './templates.js';

// DOM Elements
const templateSelect = document.getElementById('policyTemplate');
const fileInput = document.getElementById('policyFile');
const fileUploadArea = document.getElementById('fileUploadArea');
const fileName = document.getElementById('fileName');
const frameworkSelect = document.getElementById('framework');
const form = document.getElementById('analysisForm');
const loading = document.getElementById('loading');
const analyzeBtn = document.getElementById('analyzeBtn');
const emptyState = document.getElementById('emptyState');
const documentPreview = document.getElementById('documentPreview');
const results = document.getElementById('results');
const postAnalysisActions = document.getElementById('postAnalysisActions');
const newAnalysisBtn = document.getElementById('newAnalysisBtn');

// Carousel state
let currentSlide = 0;
let totalSlides = 0;

// Track current selection type
let selectedTemplate = null;

// Template selection handling
templateSelect.addEventListener('change', (e) => {
  const templateKey = e.target.value;
  
  if (templateKey) {
    fileInput.value = '';
    fileName.textContent = '';
    selectedTemplate = POLICY_TEMPLATES[templateKey];
    frameworkSelect.value = selectedTemplate.framework;
    showTemplatePreview(selectedTemplate);
  } else {
    selectedTemplate = null;
    documentPreview.style.display = 'none';
    if (!fileInput.files.length) {
      emptyState.style.display = 'block';
    }
  }
});

// File upload handling
fileInput.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    templateSelect.value = '';
    selectedTemplate = null;
    const file = e.target.files[0];
    fileName.textContent = `Selected: ${file.name}`;
    await showFilePreview(file);
  }
});

// Drag and drop
fileUploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileUploadArea.classList.add('dragover');
});

fileUploadArea.addEventListener('dragleave', () => {
  fileUploadArea.classList.remove('dragover');
});

fileUploadArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  fileUploadArea.classList.remove('dragover');
  
  if (e.dataTransfer.files.length > 0) {
    templateSelect.value = '';
    selectedTemplate = null;
    fileInput.files = e.dataTransfer.files;
    const file = e.dataTransfer.files[0];
    fileName.textContent = `Selected: ${file.name}`;
    await showFilePreview(file);
  }
});

// Show template preview
function showTemplatePreview(template) {
  emptyState.style.display = 'none';
  documentPreview.style.display = 'block';
  
  document.getElementById('previewFilename').textContent = template.name;
  document.getElementById('previewFilesize').textContent = `${Math.ceil(template.content.length / 1024)} KB (Sample Policy)`;
  
  const previewText = document.getElementById('previewText');
  const truncatedText = template.content.substring(0, 2000) + 
    (template.content.length > 2000 ? '\n\n... (preview truncated)' : '');
  previewText.textContent = truncatedText;
}

// Show file preview
async function showFilePreview(file) {
  emptyState.style.display = 'none';
  documentPreview.style.display = 'block';
  
  document.getElementById('previewFilename').textContent = file.name;
  document.getElementById('previewFilesize').textContent = formatFileSize(file.size);
  
  const previewText = document.getElementById('previewText');
  previewText.textContent = 'Loading preview...';
  
  try {
    const text = await extractText(file);
    const truncatedText = text.substring(0, 2000) + (text.length > 2000 ? '\n\n... (preview truncated)' : '');
    previewText.textContent = truncatedText;
  } catch (error) {
    previewText.textContent = 'Preview not available for this file type.';
  }
}

// Extract text from file
async function extractText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      
      if (file.type === 'application/pdf') {
        resolve('PDF text extraction requires server-side processing. Click "Analyze Policy" to continue.');
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        resolve('DOCX text extraction requires server-side processing. Click "Analyze Policy" to continue.');
      } else {
        const text = new TextDecoder().decode(arrayBuffer);
        resolve(text);
      }
    };
    
    reader.onerror = () => resolve('Failed to read file.');
    reader.readAsArrayBuffer(file);
  });
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!selectedTemplate && !fileInput.files.length) {
    alert('Please select a template or upload a policy document.');
    return;
  }
  
  let framework = frameworkSelect.value;
  if (!framework && selectedTemplate) {
    framework = selectedTemplate.framework;
  }
  
  if (!framework) {
    alert('Please select a regulatory framework.');
    return;
  }
  
  // Hide all, show loading on RIGHT side
  documentPreview.style.display = 'none';
  emptyState.style.display = 'none';
  loading.classList.add('show');
  
  try {
    let response;
    
    if (selectedTemplate) {
      response = await fetch('/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          policyText: selectedTemplate.content,
          framework: framework,
          isTemplate: true
        })
      });
    } else {
      const formData = new FormData();
      formData.append('policy', fileInput.files[0]);
      formData.append('framework', framework);
      
      response = await fetch('/analyze', {
        method: 'POST',
        body: formData
      });
    }
    
    if (!response.ok) {
      throw new Error('Analysis failed');
    }
    
    const data = await response.json();
    
    // Display results
    displayResults(data);
    
    // Update UI - HIDE FORM, SHOW POST-ANALYSIS ACTIONS
    loading.classList.remove('show');
    form.style.display = 'none';
    postAnalysisActions.style.display = 'block';
    
  } catch (error) {
    console.error('Error:', error);
    alert('Analysis failed. Please try again.');
    
    loading.classList.remove('show');
    documentPreview.style.display = 'block';
  }
});

// New analysis button
newAnalysisBtn.addEventListener('click', () => {
  form.reset();
  fileName.textContent = '';
  selectedTemplate = null;
  
  // Show form, hide results and post-analysis actions
  form.style.display = 'block';
  postAnalysisActions.style.display = 'none';
  results.style.display = 'none';
  documentPreview.style.display = 'none';
  emptyState.style.display = 'block';
});

// Carousel functions - SIMPLE 2 CARDS
window.changeSlide = function(direction) {
  currentSlide += direction;
  
  if (currentSlide < 0) {
    currentSlide = 0;
  }
  if (currentSlide > totalSlides - 2) {
    currentSlide = totalSlides - 2;
  }
  
  updateCarousel();
}

window.goToSlide = function(index) {
  currentSlide = index;
  if (currentSlide > totalSlides - 2) {
    currentSlide = totalSlides - 2;
  }
  updateCarousel();
}

function updateCarousel() {
  const track = document.getElementById('carouselTrack');
  const dots = document.querySelectorAll('.carousel-dot');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  if (track) {
    // Each card is 48% + 20px margin-right
    // Move by: 48% + 20px per slide
    track.style.transform = `translateX(calc(-${currentSlide * 48}% - ${currentSlide * 20}px))`;
  }
  
  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === currentSlide);
  });
  
  if (prevBtn && nextBtn) {
    prevBtn.disabled = currentSlide === 0;
    nextBtn.disabled = currentSlide >= totalSlides - 2;
  }
}

// Export functions
window.exportToPDF = function() {
  window.print();
}

window.copyToClipboard = function() {
  const resultsDiv = document.getElementById('results');
  const text = resultsDiv.innerText;
  
  navigator.clipboard.writeText(text).then(() => {
    alert('Analysis copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
}

window.emailAnalysis = function() {
  const resultsDiv = document.getElementById('results');
  const body = resultsDiv.innerText + '\n\n---\nGenerated by Compliance Lens\nBuilt by Mike Burns';
  
  const subject = encodeURIComponent('Compliance Gap Analysis Results');
  const mailtoLink = `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
  
  window.location.href = mailtoLink;
}

// MOCK DATA GENERATOR FOR TESTING PDFs
window.generateMockAnalysis = function() {
  const mockData = {
    summary: {
      critical: 3,
      gaps: 4,
      met: 3
    },
    findings: [
      {
        category: 'critical',
        requirement: 'Independent Testing Requirements',
        finding: 'Policy completely lacks independent testing/audit requirements for BSA/AML compliance program',
        citation: 'BSA compliance program requirements',
        recommendation: 'Establish annual independent testing program conducted by qualified internal or external parties to test BSA/AML program effectiveness and ensure timely filing within 15 days'
      },
      {
        category: 'critical',
        requirement: 'Training Requirements',
        finding: 'Training requirement is vague and does not specify annual requirement',
        citation: '31 CFR 1010.210(b)',
        recommendation: 'Mandate annual AML training for all employees and maintain training records with specific curriculum covering BSA/AML requirements'
      },
      {
        category: 'critical',
        requirement: 'Currency Transaction Reporting (CTR)',
        finding: 'Policy incorrectly states CTRs are filed using Form 8300 instead of Form 112 and does not address aggregation rules',
        citation: '31 CFR 1010.311',
        recommendation: 'Correct the form reference to Form 112 (CTR) for currency transactions over $10,000 and ensure timely filing within 15 days'
      },
      {
        category: 'gap',
        requirement: 'Customer Identification Program (CIP)',
        finding: 'CIP procedures lack specific documentary verification requirements and verification timing',
        citation: '31 CFR 1020.220',
        recommendation: 'Define specific acceptable documents for identity verification, establish clear verification timelines, and document verification procedures'
      },
      {
        category: 'gap',
        requirement: 'Enhanced Due Diligence for High-Risk Customers',
        finding: 'Policy lacks specific enhanced due diligence procedures for high-risk customers beyond additional scrutiny',
        citation: '31 CFR 1010.230(b)(5)',
        recommendation: 'Define specific enhanced due diligence measures including source of funds verification, purpose of account, and ongoing monitoring requirements'
      },
      {
        category: 'gap',
        requirement: 'Transaction Monitoring Systems',
        finding: 'Policy lacks specificity on transaction monitoring systems and thresholds',
        citation: '31 CFR 1010.230',
        recommendation: 'Define specific monitoring thresholds, automated system requirements, alert generation criteria, and investigation procedures for flagged transactions'
      },
      {
        category: 'gap',
        requirement: 'Suspicious Activity Reporting (SAR)',
        finding: 'Incorrect form referenced and lacks detail on detection procedures',
        citation: '31 CFR 1020.320',
        recommendation: 'Specify use of SAR form, not Form 8300. Add detailed procedures for identifying and investigating suspicious activity detection, investigation protocols, and staff responsibilities for identification'
      },
      {
        category: 'met',
        requirement: 'Customer Due Diligence',
        finding: 'Policy adequately addresses risk-based customer assessment',
        citation: '31 CFR 1020.210',
        evidence: 'We assess customer risk based on: Type of account, Expected account activity, Geographic location. Higher risk customers receive additional scrutiny.'
      },
      {
        category: 'met',
        requirement: 'Recordkeeping Requirements',
        finding: 'Policy meets five-year recordkeeping requirement',
        citation: '31 CFR 1010.430',
        evidence: 'We maintain records of customer identification and transaction records for five years.'
      },
      {
        category: 'met',
        requirement: 'Compliance Officer Designation',
        finding: 'Policy clearly designates oversight responsibility',
        citation: '31 CFR 1010.210',
        evidence: 'The Compliance Officer oversees this program and reports to senior management.'
      }
    ]
  };
  
  displayResults(mockData);
  
  // Show post-analysis actions
  form.style.display = 'none';
  postAnalysisActions.style.display = 'block';
  
  console.log('Mock analysis generated! Click "Export to PDF" to test print styles.');
}

// Add keyboard shortcut for quick testing: Ctrl/Cmd + Shift + M
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
    e.preventDefault();
    generateMockAnalysis();
    console.log('Mock data loaded! Press Ctrl/Cmd + P to test PDF export.');
  }
});

// Display results
function displayResults(data) {
  emptyState.style.display = 'none';
  documentPreview.style.display = 'none';
  results.style.display = 'block';
  
  let html = '<h2 class="panel-title">Gap Analysis Results</h2>';
  
  // Summary cards - REORDERED: Critical, Gaps, Met
  html += '<div class="summary-cards">';
  html += `
    <div class="summary-card critical">
      <h3>Critical Deficiencies</h3>
      <span class="card-icon">✕</span>
      <div class="metric-value">${data.summary.critical}</div>
      <div class="metric-subtitle">urgent action required</div>
    </div>
    <div class="summary-card gap">
      <h3>Gaps Identified</h3>
      <span class="card-icon">⚠</span>
      <div class="metric-value">${data.summary.gaps}</div>
      <div class="metric-subtitle">needs improvement</div>
    </div>
    <div class="summary-card met">
      <h3>Requirements Met</h3>
      <span class="card-icon">✓</span>
      <div class="metric-value">${data.summary.met}</div>
      <div class="metric-subtitle">compliant areas</div>
    </div>
  `;
  html += '</div>';
  
  // REORDER findings: Critical first, then Gaps, then Met
  const orderedFindings = [
    ...data.findings.filter(f => f.category === 'critical'),
    ...data.findings.filter(f => f.category === 'gap'),
    ...data.findings.filter(f => f.category === 'met')
  ];
  
  // Carousel section
  html += '<div class="carousel-section">';
  html += '<h3>Detailed Findings</h3>';
  
  // Carousel container
  html += '<div class="carousel-container">';
  html += '<div class="carousel-track" id="carouselTrack">';
  
  // Generate slides
  orderedFindings.forEach((finding) => {
    html += `
      <div class="carousel-slide ${finding.category}">
        <div class="slide-content">
          <div class="slide-header">
            <span class="slide-badge">${finding.category}</span>
            <h4>${finding.requirement}</h4>
          </div>
          <p><strong>Finding:</strong> ${finding.finding}</p>
          <p><strong>Citation:</strong> ${finding.citation}</p>
          ${finding.recommendation ? `<div class="slide-recommendation"><strong>Recommendation:</strong> ${finding.recommendation}</div>` : ''}
          ${finding.evidence ? `<p class="slide-evidence">"${finding.evidence}"</p>` : ''}
        </div>
      </div>
    `;
  });
  
  html += '</div>'; // close carousel-track
  html += '</div>'; // close carousel-container
  
  // Carousel controls
  html += '<div class="carousel-controls">';
  html += '<button class="carousel-btn" id="prevBtn" onclick="changeSlide(-1)">‹</button>';
  
  html += '<div class="carousel-dots">';
  const numDots = Math.max(orderedFindings.length - 1, 1);
  for (let i = 0; i < numDots; i++) {
    html += `<div class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></div>`;
  }
  html += '</div>';
  
  html += '<button class="carousel-btn" id="nextBtn" onclick="changeSlide(1)">›</button>';
  html += '</div>'; // close carousel-controls
  
  html += '</div>'; // close carousel-section
  
  results.innerHTML = html;
  
  // Initialize carousel
  totalSlides = orderedFindings.length;
  currentSlide = 0;
  updateCarousel();
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (results.style.display === 'block') {
    if (e.key === 'ArrowLeft') {
      changeSlide(-1);
    } else if (e.key === 'ArrowRight') {
      changeSlide(1);
    }
  }
});
