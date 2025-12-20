// Sample Policy Templates

const POLICY_TEMPLATES = {
  'bsa-weak': {
    name: 'Sample: Weak BSA/AML Policy',
    framework: 'BSA/AML',
    content: `ACME FINANCIAL SERVICES
BANK SECRECY ACT / ANTI-MONEY LAUNDERING POLICY

Effective Date: January 1, 2024

1. POLICY STATEMENT

ACME Financial Services is committed to complying with applicable anti-money laundering laws and regulations. This policy outlines our procedures for preventing money laundering and terrorist financing.

2. CUSTOMER IDENTIFICATION PROGRAM

All new customers must provide:
- Full legal name
- Date of birth
- Physical address
- Government-issued identification

Staff will verify customer identity by examining documentation and comparing information.

3. CUSTOMER DUE DILIGENCE

We assess customer risk based on:
- Type of account
- Expected account activity
- Geographic location

Higher risk customers receive additional scrutiny.

4. TRANSACTION MONITORING

Our staff monitors customer transactions for unusual activity. Suspicious patterns are reviewed by management.

5. SUSPICIOUS ACTIVITY REPORTING

If we identify suspicious activity, we will file a Suspicious Activity Report (SAR) with FinCEN within 30 days of detection.

We maintain records of all SARs filed.

6. CURRENCY TRANSACTION REPORTS

Transactions over $10,000 in currency are reported to FinCEN using Form 8300.

7. RECORDKEEPING

We maintain records of customer identification and transaction records for five years.

8. TRAINING

Employees receive compliance training as needed.

9. RESPONSIBILITIES

The Compliance Officer oversees this program and reports to senior management.

END OF POLICY`
  },
  
  'fcpa-flawed': {
    name: 'Sample: Flawed FCPA Policy',
    framework: 'FCPA',
    content: `GLOBAL INDUSTRIES INC.
FOREIGN CORRUPT PRACTICES ACT COMPLIANCE POLICY

Effective Date: March 15, 2024

1. PURPOSE

This policy establishes Global Industries' commitment to ethical business practices and compliance with the Foreign Corrupt Practices Act (FCPA).

2. SCOPE

This policy applies to all employees, officers, and directors of Global Industries Inc.

3. PROHIBITION ON BRIBERY

Employees are prohibited from offering, promising, or providing anything of value to foreign government officials to obtain or retain business.

4. GIFTS AND ENTERTAINMENT

Reasonable gifts and entertainment are permitted in accordance with local customs and business practices. Employees should use good judgment.

5. THIRD-PARTY RELATIONSHIPS

When engaging third parties such as agents or consultants, employees should exercise appropriate care in selection.

6. BOOKS AND RECORDS

All transactions must be accurately recorded in the company's books and records.

7. INTERNAL CONTROLS

The company maintains internal controls to ensure compliance with this policy.

8. REPORTING VIOLATIONS

Employees who suspect violations should report them to their supervisor or the compliance department.

9. TRAINING

New employees receive FCPA training during onboarding.

10. COMPLIANCE OFFICER

The Chief Compliance Officer is responsible for implementing and monitoring this policy.

11. POLICY REVIEW

This policy will be reviewed periodically and updated as necessary.

END OF POLICY`
  },
  
  'bsa-strong': {
    name: 'Sample: Comprehensive BSA/AML Policy',
    framework: 'BSA/AML',
    content: `SECURE BANK NA
COMPREHENSIVE BANK SECRECY ACT / ANTI-MONEY LAUNDERING POLICY

Effective Date: January 1, 2024
Last Review: December 1, 2024
Next Review: December 1, 2025

1. POLICY STATEMENT

Secure Bank NA is committed to full compliance with the Bank Secrecy Act (BSA) and Anti-Money Laundering (AML) regulations. This policy establishes a comprehensive framework for preventing, detecting, and reporting money laundering and terrorist financing activities.

2. CUSTOMER IDENTIFICATION PROGRAM (CIP)

In accordance with 31 CFR 1020.220, we maintain a written Customer Identification Program that includes:

2.1 Required Information
- Legal name
- Date of birth (for individuals)
- Physical address (not PO Box)
- Tax identification number (SSN/EIN)

2.2 Verification Procedures
- Documentary verification using government-issued ID
- Non-documentary verification for high-risk customers
- Verification completion within 30 days of account opening
- Customer notification within 90 days if unable to verify

3. CUSTOMER DUE DILIGENCE (CDD)

Per 31 CFR 1010.230, we conduct risk-based Customer Due Diligence including:

3.1 Risk Assessment Factors
- Product/service type
- Transaction volume and velocity
- Geographic risk (high-risk jurisdictions)
- Customer type (business entity complexity)
- Delivery channel (online, in-person)

3.2 Beneficial Ownership Identification
For legal entity customers, we identify and verify beneficial owners (25%+ ownership)

3.3 Understanding Nature and Purpose
We document the expected nature and purpose of customer relationships

4. ENHANCED DUE DILIGENCE (EDD)

High-risk customers undergo Enhanced Due Diligence:
- Politically Exposed Persons (PEPs) - senior foreign political figures
- Customers from high-risk jurisdictions (FATF list)
- High net worth individuals (>$1M)
- Money service businesses
- Non-resident aliens

EDD Requirements:
- Senior management approval for account opening
- Enhanced ongoing monitoring
- Annual account review
- Source of wealth documentation

5. POLITICALLY EXPOSED PERSONS (PEP) SCREENING

5.1 PEP Identification
We screen all customers against:
- World-Check database
- OFAC SDN list
- Internal PEP list

5.2 PEP Approval Process
- AML Officer review required
- Senior management approval mandatory
- Enhanced ongoing monitoring
- Annual relationship review

6. TRANSACTION MONITORING SYSTEM

6.1 Automated Monitoring
Our transaction monitoring system flags:
- Structuring ($10,000 threshold)
- Rapid movement of funds
- High-volume wire transfers
- Unusual cash activity
- Geographic risk patterns

6.2 Alert Review Process
- Level 1: Automated system generates alerts
- Level 2: AML Analyst reviews within 48 hours
- Level 3: AML Officer investigates escalated cases
- Level 4: SAR filing decision within 30 days

7. SUSPICIOUS ACTIVITY REPORTING (SAR)

Per 31 CFR 1020.320:

7.1 SAR Filing Criteria
File SAR within 30 days when transaction:
- Exceeds $5,000 (insider/agent abuse)
- Exceeds $5,000 (fraud/theft)
- Exceeds $5,000 (identity theft)
- Exceeds $5,000 (computer intrusion)
- Any amount (terrorist financing)

7.2 SAR Filing Process
- Investigation completion within 30 days
- SAR filing within 30 days of detection
- No customer notification
- Maintain SAR confidentiality
- Retain SARs for 5 years

7.3 SAR Documentation
- Detailed narrative of suspicious activity
- Supporting documentation attached
- Regulatory reference citations
- Law enforcement contact (if applicable)

8. CURRENCY TRANSACTION REPORTING (CTR)

Per 31 CFR 1010.311:

8.1 CTR Filing Requirements
- File FinCEN Form 112 for currency transactions >$10,000
- File within 15 days of transaction
- Aggregate related transactions
- Maintain exemption list (eligible customers)

8.2 Structuring Detection
Monitor for patterns indicating structuring:
- Multiple transactions just under $10,000
- Same-day transactions at multiple branches
- Unusual timing patterns

9. OFAC SANCTIONS SCREENING

9.1 Screening Requirements
Screen all customers and transactions against:
- Office of Foreign Assets Control (OFAC) SDN list
- Sectoral sanctions
- Country-based sanctions

9.2 Screening Frequency
- Real-time transaction screening
- Daily batch screening of customer database
- Immediate escalation of matches

10. RECORDKEEPING

Per 31 USC 5318(g):

10.1 Required Records (5-year retention)
- Customer identification documents
- SAR supporting documentation
- CTR records
- Wire transfer records ($3,000+)
- Monetary instrument sales ($3,000-$10,000)

10.2 Record Accessibility
- Electronic storage with rapid retrieval
- Backup systems maintained
- Audit trail for all access

11. TRAINING REQUIREMENTS

11.1 Initial Training
- All new employees within 30 days of hire
- Role-specific AML responsibilities
- Red flag recognition
- Reporting procedures

11.2 Annual Training
- All employees complete annual refresher
- Case studies and scenario-based learning
- Regulatory update sessions
- Testing and certification required

11.3 Specialized Training
- AML Officers: Advanced certification (CAMS)
- Front-line staff: Enhanced transaction monitoring
- Senior management: Regulatory updates quarterly

12. INDEPENDENT TESTING

Per 31 USC 5318(h):

12.1 Annual Audit Requirements
- Independent third-party testing
- Comprehensive program assessment
- Transaction testing sample (minimum 50)
- Report to Board of Directors

12.2 Audit Scope
- CIP effectiveness
- CDD/EDD procedures
- Transaction monitoring system
- SAR/CTR filing accuracy
- Training program effectiveness
- Record retention compliance

13. AML PROGRAM GOVERNANCE

13.1 Board Oversight
- Annual AML program review
- Quarterly compliance reports
- Budget approval for AML resources
- Independent testing review

13.2 Senior Management Responsibilities
- Designate AML Compliance Officer
- Ensure adequate resources
- Approve policies and procedures
- Review significant matters

13.3 AML Compliance Officer
- Day-to-day program oversight
- Regulatory liaison
- SAR filing authority
- Training coordination
- Report to Board quarterly

14. RISK ASSESSMENT

14.1 Annual Risk Assessment
Evaluate inherent risk across:
- Products and services
- Customer types
- Geographic locations
- Delivery channels

14.2 Risk Mitigation
- Enhanced controls for high-risk areas
- Resource allocation based on risk
- Continuous monitoring adjustments

15. REGULATORY EXAMINATION PREPAREDNESS

15.1 Examination Readiness
- Document retention organized
- Summary reports prepared
- Issue tracking log maintained
- Remediation evidence available

16. COMPLIANCE PROGRAM UPDATES

16.1 Policy Review Schedule
- Annual comprehensive review
- Interim updates as regulations change
- Board approval for material changes

This policy is approved by the Board of Directors and takes effect immediately.

Approved by:
Board of Directors, Secure Bank NA
January 1, 2024

END OF POLICY`
  }
};

export default POLICY_TEMPLATES;
