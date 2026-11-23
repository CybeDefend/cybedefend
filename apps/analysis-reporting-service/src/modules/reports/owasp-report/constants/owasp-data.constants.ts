/**
 * @fileoverview Static data store for OWASP Top 10 2021 categories.
 * Contains all descriptive text, factors, remediation advice, and CWE mappings
 * required for generating complete and professional security reports.
 *
 *
 * Text from the OWASP Top 10:2021 (https://owasp.org/Top10/), © OWASP
 * Foundation, licensed under CC BY-SA 4.0
 * (https://creativecommons.org/licenses/by-sa/4.0/); adapted.
 */

/**
 * Defines the structure for attack scenario examples.
 */
export interface OwaspAttackScenario {
  scenario: string;
  description: string;
}

/**
 * Defines the structure for the statistical factors of an OWASP category.
 */
export interface OwaspFactor {
  cwesMapped: number;
  maxIncidenceRate: string;
  avgIncidenceRate: string;
  avgWeightedExploit: number;
  avgWeightedImpact: number;
  maxCoverage: string;
  avgCoverage: string;
  totalOccurrences: string;
  totalCves: string;
}

/**
 * Defines the complete data structure for a single OWASP Top 10 category.
 */
export interface OwaspCategoryData {
  id: string; // e.g., 'A01'
  code: string; // e.g., 'A01:2021'
  title: string; // e.g., 'Broken Access Control'
  summary: string; // The short intro paragraph
  /** OWASP page of the category (2021 edition). */
  url: string;
  /** Condensed description (one paragraph, at most 400 characters). */
  brief: string;
  /** The 3 to 5 prevention measures shown in the reports. */
  keyPrevention: string[];

  // Detailed Section Data
  factors: OwaspFactor;
  overview: string;
  description: string;
  howToPrevent: string;
  exampleAttackScenarios: OwaspAttackScenario[];
  references: string[];
  mappedCwes: string[]; // Critical for mapping logic
}

/**
 * Main constant exporting all OWASP Top 10 2021 data.
 * This is the single source of truth for report generation.
 */
export const OWASP_TOP_10_2021_DATA: Readonly<
  Record<string, OwaspCategoryData>
> = Object.freeze({
  A01: {
    id: 'A01',
    code: 'A01:2021',
    title: 'Broken Access Control',
    url: 'https://owasp.org/Top10/A01_2021-Broken_Access_Control/',
    brief:
      'Access control keeps users within their intended permissions. When it fails, users can read, change or delete data or act outside their role: checks bypassed by tampering with URLs, identifiers or tokens, APIs reachable without authorisation, privilege escalation, cross-site request forgery or an overly permissive CORS policy.',
    keyPrevention: [
      'Deny by default, except for public resources.',
      'Implement access control once, server-side, and reuse it everywhere; keep CORS usage to a minimum.',
      'Enforce record ownership in the data model instead of trusting identifiers sent by the client.',
      'Log access control failures, alert on repeated failures and rate-limit APIs.',
      'Invalidate sessions on logout and keep JWTs short-lived.',
    ],
    summary:
      'A01:2021-Broken Access Control moves up from the fifth position; 94% of applications were tested for some form of broken access control. The 34 Common Weakness Enumerations (CWEs) mapped to Broken Access Control had more occurrences in applications than any other category.',
    factors: {
      cwesMapped: 34,
      maxIncidenceRate: '55.97%',
      avgIncidenceRate: '3.81%',
      avgWeightedExploit: 6.92,
      avgWeightedImpact: 5.93,
      maxCoverage: '94.55%',
      avgCoverage: '47.72%',
      totalOccurrences: '318,487',
      totalCves: '19,013',
    },
    overview:
      'Moving up from the fifth position, 94% of applications were tested for some form of broken access control with the average incidence rate of 3.81%, and has the most occurrences in the contributed dataset with over 318k. Notable Common Weakness Enumerations (CWEs) included are CWE-200: Exposure of Sensitive Information to an Unauthorized Actor, CWE-201: Insertion of Sensitive Information Into Sent Data, and CWE-352: Cross-Site Request Forgery.',
    description: `
      <p>Access control enforces policy such that users cannot act outside of their intended permissions. Failures typically lead to unauthorized information disclosure, modification, or destruction of all data or performing a business function outside the user's limits. Common access control vulnerabilities include:</p>
      <ul>
        <li>Violation of the principle of least privilege or deny by default, where access should only be granted for particular capabilities, roles, or users, but is available to anyone.</li>
        <li>Bypassing access control checks by modifying the URL (parameter tampering or force browsing), internal application state, or the HTML page, or by using an attack tool modifying API requests.</li>
        <li>Permitting viewing or editing someone else's account, by providing its unique identifier (insecure direct object references)</li>
        <li>Accessing API with missing access controls for POST, PUT and DELETE.</li>
        <li>Elevation of privilege. Acting as a user without being logged in or acting as an admin when logged in as a user.</li>
        <li>Metadata manipulation, such as replaying or tampering with a JSON Web Token (JWT) access control token, or a cookie or hidden field manipulated to elevate privileges or abusing JWT invalidation.</li>
        <li>CORS misconfiguration allows API access from unauthorized/untrusted origins.</li>
        <li>Force browsing to authenticated pages as an unauthenticated user or to privileged pages as a standard user.</li>
      </ul>
    `,
    howToPrevent: `
      <p>Access control is only effective in trusted server-side code or server-less API, where the attacker cannot modify the access control check or metadata.</p>
      <ul>
        <li>Except for public resources, deny by default.</li>
        <li>Implement access control mechanisms once and re-use them throughout the application, including minimizing Cross-Origin Resource Sharing (CORS) usage.</li>
        <li>Model access controls should enforce record ownership rather than accepting that the user can create, read, update, or delete any record.</li>
        <li>Unique application business limit requirements should be enforced by domain models.</li>
        <li>Disable web server directory listing and ensure file metadata (e.g., .git) and backup files are not present within web roots.</li>
        <li>Log access control failures, alert admins when appropriate (e.g., repeated failures).</li>
        <li>Rate limit API and controller access to minimize the harm from automated attack tooling.</li>
        <li>Stateful session identifiers should be invalidated on the server after logout. Stateless JWT tokens should rather be short-lived so that the window of opportunity for an attacker is minimized. For longer lived JWTs it's highly recommended to follow the OAuth standards to revoke access.</li>
        <li>Developers and QA staff should include functional access control unit and integration tests.</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          "<p>The application uses unverified data in a SQL call that is accessing account information:</p><pre><code>pstmt.setString(1, request.getParameter(\"acct\"));\nResultSet results = pstmt.executeQuery( );</code></pre><p>An attacker simply modifies the browser's 'acct' parameter to send whatever account number they want. If not correctly verified, the attacker can access any user's account.</p><pre><code>https://example.com/app/accountInfo?acct=notmyacct</code></pre>",
      },
      {
        scenario: 'Scenario #2',
        description:
          "<p>An attacker simply force browses to target URLs. Admin rights are required for access to the admin page.</p><pre><code>https://example.com/app/getappInfo\nhttps://example.com/app/admin_getappInfo</code></pre><p>If an unauthenticated user can access either page, it's a flaw. If a non-admin can access the admin page, this is a flaw.</p>",
      },
    ],
    references: [
      'OWASP Proactive Controls: Enforce Access Controls',
      'OWASP Application Security Verification Standard: V4 Access Control',
      'OWASP Testing Guide: Authorization Testing',
      'OWASP Cheat Sheet: Authorization',
      'PortSwigger: Exploiting CORS misconfiguration',
      'OAuth: Revoking Access',
    ],
    mappedCwes: [
      'CWE-22',
      'CWE-23',
      'CWE-35',
      'CWE-59',
      'CWE-200',
      'CWE-201',
      'CWE-219',
      'CWE-264',
      'CWE-275',
      'CWE-276',
      'CWE-284',
      'CWE-285',
      'CWE-352',
      'CWE-359',
      'CWE-377',
      'CWE-402',
      'CWE-425',
      'CWE-441',
      'CWE-497',
      'CWE-538',
      'CWE-540',
      'CWE-548',
      'CWE-552',
      'CWE-566',
      'CWE-601',
      'CWE-639',
      'CWE-651',
      'CWE-668',
      'CWE-706',
      'CWE-862',
      'CWE-863',
      'CWE-913',
      'CWE-922',
      'CWE-1275',
    ],
  },
  A02: {
    id: 'A02',
    code: 'A02:2021',
    title: 'Cryptographic Failures',
    url: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
    brief:
      'Sensitive data needs protection in transit and at rest. Failures include data sent in clear text (HTTP, SMTP, FTP), weak or deprecated algorithms and hash functions such as MD5 or SHA-1, hard-coded or reused keys, missing certificate validation, and passwords stored without a strong adaptive hash.',
    keyPrevention: [
      'Classify the data the application handles and do not keep sensitive data it does not need.',
      'Encrypt all data in transit with TLS and enforce it with HTTP Strict Transport Security (HSTS).',
      'Encrypt sensitive data at rest with current algorithms and proper key management; never hard-code keys.',
      'Store passwords with a salted adaptive hash: Argon2, scrypt, bcrypt or PBKDF2.',
    ],
    summary:
      'A02:2021-Cryptographic Failures shifts up one position to #2, previously known as Sensitive Data Exposure, which was broad symptom rather than a root cause. The renewed focus here is on failures related to cryptography which often leads to sensitive data exposure or system compromise.',
    factors: {
      cwesMapped: 29,
      maxIncidenceRate: '46.44%',
      avgIncidenceRate: '4.49%',
      avgWeightedExploit: 7.29,
      avgWeightedImpact: 6.81,
      maxCoverage: '79.33%',
      avgCoverage: '34.85%',
      totalOccurrences: '233,788',
      totalCves: '3,075',
    },
    overview:
      'Shifting up one position to #2, previously known as Sensitive Data Exposure, which is more of a broad symptom rather than a root cause, the focus is on failures related to cryptography (or lack thereof). Which often lead to exposure of sensitive data. Notable Common Weakness Enumerations (CWEs) included are CWE-259: Use of Hard-coded Password, CWE-327: Broken or Risky Crypto Algorithm, and CWE-331 Insufficient Entropy.',
    description: `
      <p>The first thing is to determine the protection needs of data in transit and at rest. For example, passwords, credit card numbers, health records, personal information, and business secrets require extra protection, mainly if that data falls under privacy laws, e.g., EU's General Data Protection Regulation (GDPR), or regulations, e.g., financial data protection such as PCI Data Security Standard (PCI DSS). For all such data:</p>
      <ul>
        <li>Is any data transmitted in clear text? This concerns protocols such as HTTP, SMTP, FTP also using TLS upgrades like STARTTLS. External internet traffic is hazardous. Verify all internal traffic, e.g., between load balancers, web servers, or back-end systems.</li>
        <li>Are any old or weak cryptographic algorithms or protocols used either by default or in older code?</li>
        <li>Are default crypto keys in use, weak crypto keys generated or re-used, or is proper key management or rotation missing? Are crypto keys checked into source code repositories?</li>
        <li>Is encryption not enforced, e.g., are any HTTP headers (browser) security directives or headers missing?</li>
        <li>Is the received server certificate and the trust chain properly validated?</li>
        <li>Are initialization vectors ignored, reused, or not generated sufficiently secure for the cryptographic mode of operation? Is an insecure mode of operation such as ECB in use? Is encryption used when authenticated encryption is more appropriate?</li>
        <li>Are passwords being used as cryptographic keys in absence of a password base key derivation function?</li>
        <li>Is randomness used for cryptographic purposes that was not designed to meet cryptographic requirements? Even if the correct function is chosen, does it need to be seeded by the developer, and if not, has the developer over-written the strong seeding functionality built into it with a seed that lacks sufficient entropy/unpredictability?</li>
        <li>Are deprecated hash functions such as MD5 or SHA1 in use, or are non-cryptographic hash functions used when cryptographic hash functions are needed?</li>
        <li>Are deprecated cryptographic padding methods such as PKCS number 1 v1.5 in use?</li>
        <li>Are cryptographic error messages or side channel information exploitable, for example in the form of padding oracle attacks?</li>
      </ul>
      <p>See ASVS Crypto (V7), Data Protection (V9), and SSL/TLS (V10)</p>
    `,
    howToPrevent: `
      <p>Do the following, at a minimum, and consult the references:</p>
      <ul>
        <li>Classify data processed, stored, or transmitted by an application. Identify which data is sensitive according to privacy laws, regulatory requirements, or business needs.</li>
        <li>Don't store sensitive data unnecessarily. Discard it as soon as possible or use PCI DSS compliant tokenization or even truncation. Data that is not retained cannot be stolen.</li>
        <li>Make sure to encrypt all sensitive data at rest.</li>
        <li>Ensure up-to-date and strong standard algorithms, protocols, and keys are in place; use proper key management.</li>
        <li>Encrypt all data in transit with secure protocols such as TLS with forward secrecy (FS) ciphers, cipher prioritization by the server, and secure parameters. Enforce encryption using directives like HTTP Strict Transport Security (HSTS).</li>
        <li>Disable caching for response that contain sensitive data.</li>
        <li>Apply required security controls as per the data classification.</li>
        <li>Do not use legacy protocols such as FTP and SMTP for transporting sensitive data.</li>
        <li>Store passwords using strong adaptive and salted hashing functions with a work factor (delay factor), such as Argon2, scrypt, bcrypt or PBKDF2.</li>
        <li>Initialization vectors must be chosen appropriate for the mode of operation. For many modes, this means using a CSPRNG (cryptographically secure pseudo random number generator). For modes that require a nonce, then the initialization vector (IV) does not need a CSPRNG. In all cases, the IV should never be used twice for a fixed key.</li>
        <li>Always use authenticated encryption instead of just encryption.</li>
        <li>Keys should be generated cryptographically randomly and stored in memory as byte arrays. If a password is used, then it must be converted to a key via an appropriate password base key derivation function.</li>
        <li>Ensure that cryptographic randomness is used where appropriate, and that it has not been seeded in a predictable way or with low entropy. Most modern APIs do not require the developer to seed the CSPRNG to get security.</li>
        <li>Avoid deprecated cryptographic functions and padding schemes, such as MD5, SHA1, PKCS number 1 v1.5.</li>
        <li>Verify independently the effectiveness of configuration and settings.</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          '<p>An application encrypts credit card numbers in a database using automatic database encryption. However, this data is automatically decrypted when retrieved, allowing a SQL injection flaw to retrieve credit card numbers in clear text.</p>',
      },
      {
        scenario: 'Scenario #2',
        description:
          "<p>A site doesn't use or enforce TLS for all pages or supports weak encryption. An attacker monitors network traffic (e.g., at an insecure wireless network), downgrades connections from HTTPS to HTTP, intercepts requests, and steals the user's session cookie. The attacker then replays this cookie and hijacks the user's (authenticated) session, accessing or modifying the user's private data. Instead of the above they could alter all transported data, e.g., the recipient of a money transfer.</p>",
      },
      {
        scenario: 'Scenario #3',
        description:
          "<p>The password database uses unsalted or simple hashes to store everyone's passwords. A file upload flaw allows an attacker to retrieve the password database. All the unsalted hashes can be exposed with a rainbow table of pre-calculated hashes. Hashes generated by simple or fast hash functions may be cracked by GPUs, even if they were salted.</p>",
      },
    ],
    references: [
      'OWASP Proactive Controls: Protect Data Everywhere',
      'OWASP Application Security Verification Standard (V7, 9, 10)',
      'OWASP Cheat Sheet: Transport Layer Protection',
      'OWASP Cheat Sheet: User Privacy Protection',
      'OWASP Cheat Sheet: Password Storage',
      'OWASP Cheat Sheet: Cryptographic Storage',
      'OWASP Cheat Sheet: HSTS',
      'OWASP Testing Guide: Testing for weak cryptography',
    ],
    mappedCwes: [
      'CWE-259',
      'CWE-261',
      'CWE-296',
      'CWE-310',
      'CWE-319',
      'CWE-321',
      'CWE-322',
      'CWE-323',
      'CWE-324',
      'CWE-325',
      'CWE-326',
      'CWE-327',
      'CWE-328',
      'CWE-329',
      'CWE-330',
      'CWE-331',
      'CWE-335',
      'CWE-336',
      'CWE-337',
      'CWE-338',
      'CWE-340',
      'CWE-347',
      'CWE-523',
      'CWE-720',
      'CWE-757',
      'CWE-759',
      'CWE-760',
      'CWE-780',
      'CWE-818',
      'CWE-916',
    ],
  },
  A03: {
    id: 'A03',
    code: 'A03:2021',
    title: 'Injection',
    url: 'https://owasp.org/Top10/A03_2021-Injection/',
    brief:
      'An application is open to injection when untrusted data reaches an interpreter without validation, filtering or escaping: SQL, NoSQL, OS command or LDAP queries built by concatenation, or code evaluated at run time. Cross-site scripting (XSS) is part of this category since the 2021 edition.',
    keyPrevention: [
      'Use safe APIs: parameterised queries, prepared statements or an ORM, never string concatenation.',
      'Never evaluate code built from user input (eval, Function, dynamic templates).',
      'Validate input server-side against an allow-list.',
      'Encode output for its context (HTML, attribute, URL, JavaScript) to prevent XSS.',
      'Use LIMIT and similar controls to cap the disclosure if an injection succeeds.',
    ],
    summary:
      'A03:2021-Injection slides down to the third position. 94% of the applications were tested for some form of injection, and the 33 CWEs mapped into this category have the second most occurrences in applications. Cross-site Scripting is now part of this category in this edition.',
    factors: {
      cwesMapped: 33,
      maxIncidenceRate: '19.09%',
      avgIncidenceRate: '3.37%',
      avgWeightedExploit: 7.25,
      avgWeightedImpact: 7.15,
      maxCoverage: '94.04%',
      avgCoverage: '47.90%',
      totalOccurrences: '274,228',
      totalCves: '32,078',
    },
    overview:
      'Injection slides down to the third position. 94% of the applications were tested for some form of injection with a max incidence rate of 19%, an average incidence rate of 3%, and 274k occurrences. Notable Common Weakness Enumerations (CWEs) included are CWE-79: Cross-site Scripting, CWE-89: SQL Injection, and CWE-73: External Control of File Name or Path.',
    description: `
      <p>An application is vulnerable to attack when:</p>
      <ul>
        <li>User-supplied data is not validated, filtered, or sanitized by the application.</li>
        <li>Dynamic queries or non-parameterized calls without context-aware escaping are used directly in the interpreter.</li>
        <li>Hostile data is used within object-relational mapping (ORM) search parameters to extract additional, sensitive records.</li>
        <li>Hostile data is directly used or concatenated. The SQL or command contains the structure and malicious data in dynamic queries, commands, or stored procedures.</li>
      </ul>
      <p>Some of the more common injections are SQL, NoSQL, OS command, Object Relational Mapping (ORM), LDAP, and Expression Language (EL) or Object Graph Navigation Library (OGNL) injection. The concept is identical among all interpreters. Source code review is the best method of detecting if applications are vulnerable to injections. Automated testing of all parameters, headers, URL, cookies, JSON, SOAP, and XML data inputs is strongly encouraged. Organizations can include static (SAST), dynamic (DAST), and interactive (IAST) application security testing tools into the CI/CD pipeline to identify introduced injection flaws before production deployment.</p>
    `,
    howToPrevent: `
      <p>Preventing injection requires keeping data separate from commands and queries:</p>
      <ul>
        <li>The preferred option is to use a safe API, which avoids using the interpreter entirely, provides a parameterized interface, or migrates to Object Relational Mapping Tools (ORMs).<br><em>Note: Even when parameterized, stored procedures can still introduce SQL injection if PL/SQL or T-SQL concatenates queries and data or executes hostile data with EXECUTE IMMEDIATE or exec().</em></li>
        <li>Use positive server-side input validation. This is not a complete defense as many applications require special characters, such as text areas or APIs for mobile applications.</li>
        <li>For any residual dynamic queries, escape special characters using the specific escape syntax for that interpreter.<br><em>Note: SQL structures such as table names, column names, and so on cannot be escaped, and thus user-supplied structure names are dangerous. This is a common issue in report-writing software.</em></li>
        <li>Use LIMIT and other SQL controls within queries to prevent mass disclosure of records in case of SQL injection.</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          '<p>An application uses untrusted data in the construction of the following vulnerable SQL call:</p><pre><code>String query = "SELECT * FROM accounts WHERE custID=\'" + request.getParameter("id") + "\'";</code></pre>',
      },
      {
        scenario: 'Scenario #2',
        description:
          '<p>Similarly, an application’s blind trust in frameworks may result in queries that are still vulnerable, (e.g., Hibernate Query Language (HQL)):</p><pre><code>Query HQLQuery = session.createQuery("FROM accounts WHERE custID=\'" + request.getParameter("id") + "\'");</code></pre><p>In both cases, the attacker modifies the ‘id’ parameter value in their browser to send: \' UNION SLEEP(10);--. For example:</p><pre><code>http://example.com/app/accountView?id=\' UNION SELECT SLEEP(10);--</code></pre><p>This changes the meaning of both queries to return all the records from the accounts table. More dangerous attacks could modify or delete data or even invoke stored procedures.</p>',
      },
    ],
    references: [
      'OWASP Proactive Controls: Secure Database Access',
      'OWASP ASVS: V5 Input Validation and Encoding',
      'OWASP Testing Guide: SQL Injection, Command Injection, and ORM Injection',
      'OWASP Cheat Sheet: Injection Prevention',
      'OWASP Cheat Sheet: SQL Injection Prevention',
      'OWASP Cheat Sheet: Injection Prevention in Java',
      'OWASP Cheat Sheet: Query Parameterization',
      'OWASP Automated Threats to Web Applications – OAT-014',
      'PortSwigger: Server-side template injection',
    ],
    mappedCwes: [
      'CWE-20',
      'CWE-74',
      'CWE-75',
      'CWE-77',
      'CWE-78',
      'CWE-79',
      'CWE-80',
      'CWE-83',
      'CWE-87',
      'CWE-88',
      'CWE-89',
      'CWE-90',
      'CWE-91',
      'CWE-93',
      'CWE-94',
      'CWE-95',
      'CWE-96',
      'CWE-97',
      'CWE-98',
      'CWE-99',
      'CWE-100',
      'CWE-113',
      'CWE-116',
      'CWE-138',
      'CWE-184',
      'CWE-470',
      'CWE-471',
      'CWE-564',
      'CWE-610',
      'CWE-643',
      'CWE-644',
      'CWE-652',
      'CWE-917',
    ],
  },
  A04: {
    id: 'A04',
    code: 'A04:2021',
    title: 'Insecure Design',
    url: 'https://owasp.org/Top10/A04_2021-Insecure_Design/',
    brief:
      'Insecure design covers missing or ineffective security controls: weaknesses that a flawless implementation cannot fix because the control was never designed, such as unsafe defaults, missing threat modelling, or business logic that does not account for abuse.',
    keyPrevention: [
      'Establish a secure development lifecycle, with security involved from the design stage.',
      'Threat-model authentication, access control, business logic and key flows.',
      'Build on a library of secure design patterns and secure-by-default components.',
      'Write unit and integration tests that check critical flows resist misuse.',
    ],
    summary:
      'A04:2021-Insecure Design is a new category for 2021, with a focus on risks related to design flaws. If we genuinely want to “move left” as an industry, it calls for more use of threat modeling, secure design patterns and principles, and reference architectures.',
    factors: {
      cwesMapped: 40,
      maxIncidenceRate: '24.19%',
      avgIncidenceRate: '3.00%',
      avgWeightedExploit: 6.46,
      avgWeightedImpact: 6.78,
      maxCoverage: '77.25%',
      avgCoverage: '42.51%',
      totalOccurrences: '262,407',
      totalCves: '2,691',
    },
    overview:
      'A new category for 2021 focuses on risks related to design and architectural flaws, with a call for more use of threat modeling, secure design patterns, and reference architectures. As a community we need to move beyond "shift-left" in the coding space to pre-code activities that are critical for the principles of Secure by Design. Notable Common Weakness Enumerations (CWEs) include CWE-209: Generation of Error Message Containing Sensitive Information, CWE-256: Unprotected Storage of Credentials, CWE-501: Trust Boundary Violation, and CWE-522: Insufficiently Protected Credentials.',
    description: `
      <p>Insecure design is a broad category representing different weaknesses, expressed as “missing or ineffective control design.” Insecure design is not the source for all other Top 10 risk categories. There is a difference between insecure design and insecure implementation. We differentiate between design flaws and implementation defects for a reason, they have different root causes and remediation. A secure design can still have implementation defects leading to vulnerabilities that may be exploited. An insecure design cannot be fixed by a perfect implementation as by definition, needed security controls were never created to defend against specific attacks. One of the factors that contribute to insecure design is the lack of business risk profiling inherent in the software or system being developed, and thus the failure to determine what level of security design is required.</p>
      
      <h3>Requirements and Resource Management</h3>
      <p>Collect and negotiate the business requirements for an application with the business, including the protection requirements concerning confidentiality, integrity, availability, and authenticity of all data assets and the expected business logic. Take into account how exposed your application will be and if you need segregation of tenants (additionally to access control). Compile the technical requirements, including functional and non-functional security requirements. Plan and negotiate the budget covering all design, build, testing, and operation, including security activities.</p>
      
      <h3>Secure Design</h3>
      <p>Secure design is a culture and methodology that constantly evaluates threats and ensures that code is robustly designed and tested to prevent known attack methods. Threat modeling should be integrated into refinement sessions (or similar activities); look for changes in data flows and access control or other security controls. In the user story development determine the correct flow and failure states, ensure they are well understood and agreed upon by responsible and impacted parties. Analyze assumptions and conditions for expected and failure flows, ensure they are still accurate and desirable. Determine how to validate the assumptions and enforce conditions needed for proper behaviors. Ensure the results are documented in the user story. Learn from mistakes and offer positive incentives to promote improvements. Secure design is neither an add-on nor a tool that you can add to software.</p>
      
      <h3>Secure Development Lifecycle</h3>
      <p>Secure software requires a secure development lifecycle, some form of secure design pattern, paved road methodology, secured component library, tooling, and threat modeling. Reach out for your security specialists at the beginning of a software project throughout the whole project and maintenance of your software. Consider leveraging the OWASP Software Assurance Maturity Model (SAMM) to help structure your secure software development efforts.</p>
    `,
    howToPrevent: `
      <ul>
        <li>Establish and use a secure development lifecycle with AppSec professionals to help evaluate and design security and privacy-related controls</li>
        <li>Establish and use a library of secure design patterns or paved road ready to use components</li>
        <li>Use threat modeling for critical authentication, access control, business logic, and key flows</li>
        <li>Integrate security language and controls into user stories</li>
        <li>Integrate plausibility checks at each tier of your application (from frontend to backend)</li>
        <li>Write unit and integration tests to validate that all critical flows are resistant to the threat model. Compile use-cases and misuse-cases for each tier of your application.</li>
        <li>Segregate tier layers on the system and network layers depending on the exposure and protection needs</li>
        <li>Segregate tenants robustly by design throughout all tiers</li>
        <li>Limit resource consumption by user or service</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          '<p>A credential recovery workflow might include “questions and answers,” which is prohibited by NIST 800-63b, the OWASP ASVS, and the OWASP Top 10. Questions and answers cannot be trusted as evidence of identity as more than one person can know the answers, which is why they are prohibited. Such code should be removed and replaced with a more secure design.</p>',
      },
      {
        scenario: 'Scenario #2',
        description:
          '<p>A cinema chain allows group booking discounts and has a maximum of fifteen attendees before requiring a deposit. Attackers could threat model this flow and test if they could book six hundred seats and all cinemas at once in a few requests, causing a massive loss of income.</p>',
      },
      {
        scenario: 'Scenario #3',
        description:
          '<p>A retail chain’s e-commerce website does not have protection against bots run by scalpers buying high-end video cards to resell auction websites. This creates terrible publicity for the video card makers and retail chain owners and enduring bad blood with enthusiasts who cannot obtain these cards at any price. Careful anti-bot design and domain logic rules, such as purchases made within a few seconds of availability, might identify inauthentic purchases and rejected such transactions.</p>',
      },
    ],
    references: [
      'OWASP Cheat Sheet: Secure Design Principles',
      'OWASP SAMM: Design:Security Architecture',
      'OWASP SAMM: Design:Threat Assessment',
      'NIST – Guidelines on Minimum Standards for Developer Verification of Software',
      'The Threat Modeling Manifesto',
      'Awesome Threat Modeling',
    ],
    mappedCwes: [
      'CWE-73',
      'CWE-183',
      'CWE-209',
      'CWE-213',
      'CWE-235',
      'CWE-256',
      'CWE-257',
      'CWE-266',
      'CWE-269',
      'CWE-280',
      'CWE-311',
      'CWE-312',
      'CWE-313',
      'CWE-316',
      'CWE-419',
      'CWE-430',
      'CWE-434',
      'CWE-444',
      'CWE-451',
      'CWE-472',
      'CWE-501',
      'CWE-522',
      'CWE-525',
      'CWE-539',
      'CWE-579',
      'CWE-598',
      'CWE-602',
      'CWE-642',
      'CWE-646',
      'CWE-650',
      'CWE-653',
      'CWE-656',
      'CWE-657',
      'CWE-799',
      'CWE-807',
      'CWE-840',
      'CWE-841',
      'CWE-927',
      'CWE-1021',
      'CWE-1173',
    ],
  },
  A05: {
    id: 'A05',
    code: 'A05:2021',
    title: 'Security Misconfiguration',
    url: 'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
    brief:
      'Security misconfiguration covers insecure settings at any level of the stack: default accounts and configurations, unnecessary features, ports or privileges enabled, missing hardening of cloud or container settings, missing security headers, and error messages that reveal internal details.',
    keyPrevention: [
      'Use a repeatable, automated hardening process, identical across environments.',
      'Keep the platform minimal: remove unused features, components and services.',
      'Review configurations with every patch, including cloud and container permissions.',
      'Verify the effectiveness of the configuration automatically in every environment.',
    ],
    summary:
      'A05:2021-Security Misconfiguration moves up from #6 in the previous edition; 90% of applications were tested for some form of misconfiguration. With more shifts into highly configurable software, it’s not surprising to see this category move up. The former category for XML External Entities (XXE) is now part of this category.',
    factors: {
      cwesMapped: 20,
      maxIncidenceRate: '19.84%',
      avgIncidenceRate: '4.51%',
      avgWeightedExploit: 8.12,
      avgWeightedImpact: 6.56,
      maxCoverage: '89.58%',
      avgCoverage: '44.84%',
      totalOccurrences: '208,387',
      totalCves: '789',
    },
    overview:
      "Moving up from #6 in the previous edition, 90% of applications were tested for some form of misconfiguration, with an average incidence rate of 4.51%, and over 208k occurrences of a Common Weakness Enumeration (CWE) in this risk category. With more shifts into highly configurable software, it's not surprising to see this category move up. Notable CWEs included are CWE-16 Configuration and CWE-611 Improper Restriction of XML External Entity Reference.",
    description: `
      <p>The application might be vulnerable if the application is:</p>
      <ul>
        <li>Missing appropriate security hardening across any part of the application stack or improperly configured permissions on cloud services.</li>
        <li>Unnecessary features are enabled or installed (e.g., unnecessary ports, services, pages, accounts, or privileges).</li>
        <li>Default accounts and their passwords are still enabled and unchanged.</li>
        <li>Error handling reveals stack traces or other overly informative error messages to users.</li>
        <li>For upgraded systems, the latest security features are disabled or not configured securely.</li>
        <li>The security settings in the application servers, application frameworks (e.g., Struts, Spring, ASP.NET), libraries, databases, etc., are not set to secure values.</li>
        <li>The server does not send security headers or directives, or they are not set to secure values.</li>
        <li>The software is out of date or vulnerable (see A06:2021-Vulnerable and Outdated Components).</li>
      </ul>
      <p>Without a concerted, repeatable application security configuration process, systems are at a higher risk.</p>
    `,
    howToPrevent: `
      <p>Secure installation processes should be implemented, including:</p>
      <ul>
        <li>A repeatable hardening process makes it fast and easy to deploy another environment that is appropriately locked down. Development, QA, and production environments should all be configured identically, with different credentials used in each environment. This process should be automated to minimize the effort required to set up a new secure environment.</li>
        <li>A minimal platform without any unnecessary features, components, documentation, and samples. Remove or do not install unused features and frameworks.</li>
        <li>A task to review and update the configurations appropriate to all security notes, updates, and patches as part of the patch management process (see A06:2021-Vulnerable and Outdated Components). Review cloud storage permissions (e.g., S3 bucket permissions).</li>
        <li>A segmented application architecture provides effective and secure separation between components or tenants, with segmentation, containerization, or cloud security groups (ACLs).</li>
        <li>Sending security directives to clients, e.g., Security Headers.</li>
        <li>An automated process to verify the effectiveness of the configurations and settings in all environments.</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          "<p>The application server comes with sample applications not removed from the production server. These sample applications have known security flaws attackers use to compromise the server. Suppose one of these applications is the admin console, and default accounts weren't changed. In that case, the attacker logs in with default passwords and takes over.</p>",
      },
      {
        scenario: 'Scenario #2',
        description:
          '<p>Directory listing is not disabled on the server. An attacker discovers they can simply list directories. The attacker finds and downloads the compiled Java classes, which they decompile and reverse engineer to view the code. The attacker then finds a severe access control flaw in the application.</p>',
      },
      {
        scenario: 'Scenario #3',
        description:
          "<p>The application server's configuration allows detailed error messages, e.g., stack traces, to be returned to users. This potentially exposes sensitive information or underlying flaws such as component versions that are known to be vulnerable.</p>",
      },
      {
        scenario: 'Scenario #4',
        description:
          '<p>A cloud service provider (CSP) has default sharing permissions open to the Internet by other CSP users. This allows sensitive data stored within cloud storage to be accessed.</p>',
      },
    ],
    references: [
      'OWASP Testing Guide: Configuration Management',
      'OWASP Testing Guide: Testing for Error Codes',
      'Application Security Verification Standard V14 Configuration',
      'NIST Guide to General Server Hardening',
      'CIS Security Configuration Guides/Benchmarks',
      'Amazon S3 Bucket Discovery and Enumeration',
    ],
    mappedCwes: [
      'CWE-2',
      'CWE-11',
      'CWE-13',
      'CWE-15',
      'CWE-16',
      'CWE-260',
      'CWE-315',
      'CWE-520',
      'CWE-526',
      'CWE-537',
      'CWE-541',
      'CWE-547',
      'CWE-611',
      'CWE-614',
      'CWE-756',
      'CWE-776',
      'CWE-942',
      'CWE-1004',
      'CWE-1032',
      'CWE-1174',
    ],
  },
  A06: {
    id: 'A06',
    code: 'A06:2021',
    title: 'Vulnerable and Outdated Components',
    url: 'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/',
    brief:
      'Applications inherit the vulnerabilities of the components they run: libraries, frameworks, container base images and system packages. The risk grows when versions are unknown, unsupported or patched late, and when updated libraries are not tested for compatibility.',
    keyPrevention: [
      'Keep an inventory of components and versions, direct and transitive (SBOM).',
      'Upgrade vulnerable packages to a fixed version on a risk-based schedule.',
      'Remove unused dependencies, features and files.',
      'Obtain components from official sources over secure links, preferably signed.',
      'Monitor for components that are unmaintained or no longer receive security patches.',
    ],
    summary:
      'A06:2021-Vulnerable and Outdated Components was previously titled Using Components with Known Vulnerabilities and is #2 in the Top 10 community survey, but also had enough data to make the Top 10 via data analysis. This category moves up from #9 in 2017 and is a known issue that we struggle to test and assess risk. It is the only category not to have any Common Vulnerability and Exposures (CVEs) mapped to the included CWEs, so a default exploit and impact weights of 5.0 are factored into their scores.',
    factors: {
      cwesMapped: 3,
      maxIncidenceRate: '27.96%',
      avgIncidenceRate: '8.77%',
      avgWeightedExploit: 5.0,
      avgWeightedImpact: 5.0,
      maxCoverage: '51.78%',
      avgCoverage: '22.47%',
      totalOccurrences: '30,457',
      totalCves: '0',
    },
    overview:
      'It was #2 from the Top 10 community survey but also had enough data to make the Top 10 via data. Vulnerable Components are a known issue that we struggle to test and assess risk and is the only category to not have any Common Vulnerability and Exposures (CVEs) mapped to the included CWEs, so a default exploits/impact weight of 5.0 is used. Notable CWEs included are CWE-1104: Use of Unmaintained Third-Party Components and the two CWEs from Top 10 2013 and 2017.',
    description: `
      <p>You are likely vulnerable:</p>
      <ul>
        <li>If you do not know the versions of all components you use (both client-side and server-side). This includes components you directly use as well as nested dependencies.</li>
        <li>If the software is vulnerable, unsupported, or out of date. This includes the OS, web/application server, database management system (DBMS), applications, APIs and all components, runtime environments, and libraries.</li>
        <li>If you do not scan for vulnerabilities regularly and subscribe to security bulletins related to the components you use.</li>
        <li>If you do not fix or upgrade the underlying platform, frameworks, and dependencies in a risk-based, timely fashion. This commonly happens in environments when patching is a monthly or quarterly task under change control, leaving organizations open to days or months of unnecessary exposure to fixed vulnerabilities.</li>
        <li>If software developers do not test the compatibility of updated, upgraded, or patched libraries.</li>
        <li>If you do not secure the components’ configurations (see A05:2021-Security Misconfiguration).</li>
      </ul>
    `,
    howToPrevent: `
      <p>There should be a patch management process in place to:</p>
      <ul>
        <li>Remove unused dependencies, unnecessary features, components, files, and documentation.</li>
        <li>Continuously inventory the versions of both client-side and server-side components (e.g., frameworks, libraries) and their dependencies using tools like versions, OWASP Dependency Check, retire.js, etc. Continuously monitor sources like Common Vulnerability and Exposures (CVE) and National Vulnerability Database (NVD) for vulnerabilities in the components. Use software composition analysis tools to automate the process. Subscribe to email alerts for security vulnerabilities related to components you use.</li>
        <li>Only obtain components from official sources over secure links. Prefer signed packages to reduce the chance of including a modified, malicious component (see A08:2021-Software and Data Integrity Failures).</li>
        <li>Monitor for libraries and components that are unmaintained or do not create security patches for older versions. If patching is not possible, consider deploying a virtual patch to monitor, detect, or protect against the discovered issue.</li>
      </ul>
      <p>Every organization must ensure an ongoing plan for monitoring, triaging, and applying updates or configuration changes for the lifetime of the application or portfolio.</p>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          '<p>Components typically run with the same privileges as the application itself, so flaws in any component can result in serious impact. Such flaws can be accidental (e.g., coding error) or intentional (e.g., a backdoor in a component). Some example exploitable component vulnerabilities discovered are:</p><ul><li>CVE-2017-5638, a Struts 2 remote code execution vulnerability that enables the execution of arbitrary code on the server, has been blamed for significant breaches.</li><li>While the internet of things (IoT) is frequently difficult or impossible to patch, the importance of patching them can be great (e.g., biomedical devices).</li><li>There are automated tools to help attackers find unpatched or misconfigured systems. For example, the Shodan IoT search engine can help you find devices that still suffer from Heartbleed vulnerability patched in April 2014.</li></ul>',
      },
    ],
    references: [
      'OWASP Application Security Verification Standard: V1 Architecture, design and threat modelling',
      'OWASP Dependency Check (for Java and .NET libraries)',
      'OWASP Testing Guide - Map Application Architecture (OTG-INFO-010)',
      'OWASP Virtual Patching Best Practices',
      'The Unfortunate Reality of Insecure Libraries',
      'MITRE Common Vulnerabilities and Exposures (CVE) search',
      'National Vulnerability Database (NVD)',
      'Retire.js for detecting known vulnerable JavaScript libraries',
      'GitHub Advisory Database',
      'Ruby Libraries Security Advisory Database and Tools',
      'SAFECode Software Integrity Controls [PDF]',
    ],
    mappedCwes: ['CWE-937', 'CWE-1035', 'CWE-1104'],
  },
  A07: {
    id: 'A07',
    code: 'A07:2021',
    title: 'Identification and Authentication Failures',
    url: 'https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/',
    brief:
      'Authentication weaknesses let attackers impersonate users: credential stuffing and brute force, default, weak or hard-coded credentials, weak credential recovery, passwords stored in clear or with a weak hash, missing multi-factor authentication, and session identifiers that are exposed or never invalidated.',
    keyPrevention: [
      'Implement multi-factor authentication where possible.',
      'Never ship default credentials and never hard-code credentials or hashes in source code.',
      'Check new passwords against lists of weak and breached passwords.',
      'Limit or progressively delay failed login attempts, and log them.',
      'Use a server-side session manager with random session IDs invalidated on logout.',
    ],
    summary:
      'A07:2021-Identification and Authentication Failures was previously Broken Authentication and is sliding down from the second position, and now includes CWEs that are more related to identification failures. This category is still an integral part of the Top 10, but the increased availability of standardized frameworks seems to be helping.',
    factors: {
      cwesMapped: 22,
      maxIncidenceRate: '14.84%',
      avgIncidenceRate: '2.55%',
      avgWeightedExploit: 7.4,
      avgWeightedImpact: 6.5,
      maxCoverage: '79.51%',
      avgCoverage: '45.72%',
      totalOccurrences: '132,195',
      totalCves: '3,897',
    },
    overview:
      'Previously known as Broken Authentication, this category slid down from the second position and now includes Common Weakness Enumerations (CWEs) related to identification failures. Notable CWEs included are CWE-297: Improper Validation of Certificate with Host Mismatch, CWE-287: Improper Authentication, and CWE-384: Session Fixation.',
    description: `
      <p>Confirmation of the user's identity, authentication, and session management is critical to protect against authentication-related attacks. There may be authentication weaknesses if the application:</p>
      <ul>
        <li>Permits automated attacks such as credential stuffing, where the attacker has a list of valid usernames and passwords.</li>
        <li>Permits brute force or other automated attacks.</li>
        <li>Permits default, weak, or well-known passwords, such as "Password1" or "admin/admin".</li>
        <li>Uses weak or ineffective credential recovery and forgot-password processes, such as "knowledge-based answers," which cannot be made safe.</li>
        <li>Uses plain text, encrypted, or weakly hashed passwords data stores (see A02:2021-Cryptographic Failures).</li>
        <li>Has missing or ineffective multi-factor authentication.</li>
        <li>Exposes session identifier in the URL.</li>
        <li>Reuse session identifier after successful login.</li>
        <li>Does not correctly invalidate Session IDs. User sessions or authentication tokens (mainly single sign-on (SSO) tokens) aren't properly invalidated during logout or a period of inactivity.</li>
      </ul>
    `,
    howToPrevent: `
      <ul>
        <li>Where possible, implement multi-factor authentication to prevent automated credential stuffing, brute force, and stolen credential reuse attacks.</li>
        <li>Do not ship or deploy with any default credentials, particularly for admin users.</li>
        <li>Implement weak password checks, such as testing new or changed passwords against the top 10,000 worst passwords list.</li>
        <li>Align password length, complexity, and rotation policies with National Institute of Standards and Technology (NIST) 800-63b's guidelines in section 5.1.1 for Memorized Secrets or other modern, evidence-based password policies.</li>
        <li>Ensure registration, credential recovery, and API pathways are hardened against account enumeration attacks by using the same messages for all outcomes.</li>
        <li>Limit or increasingly delay failed login attempts, but be careful not to create a denial of service scenario. Log all failures and alert administrators when credential stuffing, brute force, or other attacks are detected.</li>
        <li>Use a server-side, secure, built-in session manager that generates a new random session ID with high entropy after login. Session identifier should not be in the URL, be securely stored, and invalidated after logout, idle, and absolute timeouts.</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          '<p>Credential stuffing, the use of lists of known passwords, is a common attack. Suppose an application does not implement automated threat or credential stuffing protection. In that case, the application can be used as a password oracle to determine if the credentials are valid.</p>',
      },
      {
        scenario: 'Scenario #2',
        description:
          '<p>Most authentication attacks occur due to the continued use of passwords as a sole factor. Once considered best practices, password rotation and complexity requirements encourage users to use and reuse weak passwords. Organizations are recommended to stop these practices per NIST 800-63 and use multi-factor authentication.</p>',
      },
      {
        scenario: 'Scenario #3',
        description:
          '<p>Application session timeouts aren\'t set correctly. A user uses a public computer to access an application. Instead of selecting "logout," the user simply closes the browser tab and walks away. An attacker uses the same browser an hour later, and the user is still authenticated.</p>',
      },
    ],
    references: [
      'OWASP Proactive Controls: Implement Digital Identity',
      'OWASP Application Security Verification Standard: V2 authentication',
      'OWASP Application Security Verification Standard: V3 Session Management',
      'OWASP Testing Guide: Identity, Authentication',
      'OWASP Cheat Sheet: Authentication',
      'OWASP Cheat Sheet: Credential Stuffing',
      'OWASP Cheat Sheet: Forgot Password',
      'OWASP Cheat Sheet: Session Management',
      'OWASP Automated Threats Handbook',
      'NIST 800-63b: 5.1.1 Memorized Secrets',
    ],
    mappedCwes: [
      'CWE-255',
      'CWE-259',
      'CWE-287',
      'CWE-288',
      'CWE-290',
      'CWE-294',
      'CWE-295',
      'CWE-297',
      'CWE-300',
      'CWE-302',
      'CWE-304',
      'CWE-306',
      'CWE-307',
      'CWE-346',
      'CWE-384',
      'CWE-521',
      'CWE-613',
      'CWE-620',
      'CWE-640',
      'CWE-798',
      'CWE-940',
      'CWE-1216',
    ],
  },
  A08: {
    id: 'A08',
    code: 'A08:2021',
    title: 'Software and Data Integrity Failures',
    url: 'https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/',
    brief:
      'Integrity failures occur when code or infrastructure trusts software, updates or data without verifying them: plugins and libraries from untrusted sources, updates applied without signature checks, insecure CI/CD pipelines, and deserialisation of untrusted data.',
    keyPrevention: [
      'Verify that software and data come from the expected source unaltered, e.g. with digital signatures.',
      'Consume libraries and images only from trusted repositories.',
      'Review code and configuration changes, and restrict access to the CI/CD pipeline.',
      'Never deserialise untrusted data without an integrity check.',
    ],
    summary:
      'A08:2021-Software and Data Integrity Failures is a new category for 2021, focusing on making assumptions related to software updates, critical data, and CI/CD pipelines without verifying integrity. One of the highest weighted impacts from Common Vulnerability and Exposures/Common Vulnerability Scoring System (CVE/CVSS) data mapped to the 10 CWEs in this category. Insecure Deserialization from 2017 is now a part of this larger category.',
    factors: {
      cwesMapped: 10,
      maxIncidenceRate: '16.67%',
      avgIncidenceRate: '2.05%',
      avgWeightedExploit: 6.94,
      avgWeightedImpact: 7.94,
      maxCoverage: '75.04%',
      avgCoverage: '45.35%',
      totalOccurrences: '47,972',
      totalCves: '1,152',
    },
    overview:
      'A new category for 2021 focuses on making assumptions related to software updates, critical data, and CI/CD pipelines without verifying integrity. One of the highest weighted impacts from Common Vulnerability and Exposures/Common Vulnerability Scoring System (CVE/CVSS) data. Notable Common Weakness Enumerations (CWEs) include CWE-829: Inclusion of Functionality from Untrusted Control Sphere, CWE-494: Download of Code Without Integrity Check, and CWE-502: Deserialization of Untrusted Data.',
    description: `
      <p>Software and data integrity failures relate to code and infrastructure that does not protect against integrity violations. An example of this is where an application relies upon plugins, libraries, or modules from untrusted sources, repositories, and content delivery networks (CDNs). An insecure CI/CD pipeline can introduce the potential for unauthorized access, malicious code, or system compromise. Lastly, many applications now include auto-update functionality, where updates are downloaded without sufficient integrity verification and applied to the previously trusted application. Attackers could potentially upload their own updates to be distributed and run on all installations. Another example is where objects or data are encoded or serialized into a structure that an attacker can see and modify is vulnerable to insecure deserialization.</p>
    `,
    howToPrevent: `
      <ul>
        <li>Use digital signatures or similar mechanisms to verify the software or data is from the expected source and has not been altered.</li>
        <li>Ensure libraries and dependencies, such as npm or Maven, are consuming trusted repositories. If you have a higher risk profile, consider hosting an internal known-good repository that's vetted.</li>
        <li>Ensure that a software supply chain security tool, such as OWASP Dependency Check or OWASP CycloneDX, is used to verify that components do not contain known vulnerabilities</li>
        <li>Ensure that there is a review process for code and configuration changes to minimize the chance that malicious code or configuration could be introduced into your software pipeline.</li>
        <li>Ensure that your CI/CD pipeline has proper segregation, configuration, and access control to ensure the integrity of the code flowing through the build and deploy processes.</li>
        <li>Ensure that unsigned or unencrypted serialized data is not sent to untrusted clients without some form of integrity check or digital signature to detect tampering or replay of the serialized data</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1: Update without signing',
        description:
          '<p>Many home routers, set-top boxes, device firmware, and others do not verify updates via signed firmware. Unsigned firmware is a growing target for attackers and is expected to only get worse. This is a major concern as many times there is no mechanism to remediate other than to fix in a future version and wait for previous versions to age out.</p>',
      },
      {
        scenario: 'Scenario #2: SolarWinds malicious update',
        description:
          '<p>Nation-states have been known to attack update mechanisms, with a recent notable attack being the SolarWinds Orion attack. The company that develops the software had secure build and update integrity processes. Still, these were able to be subverted, and for several months, the firm distributed a highly targeted malicious update to more than 18,000 organizations, of which around 100 or so were affected. This is one of the most far-reaching and most significant breaches of this nature in history.</p>',
      },
      {
        scenario: 'Scenario #3: Insecure Deserialization',
        description:
          '<p>A React application calls a set of Spring Boot microservices. Being functional programmers, they tried to ensure that their code is immutable. The solution they came up with is serializing the user state and passing it back and forth with each request. An attacker notices the "rO0" Java object signature (in base64) and uses the Java Serial Killer tool to gain remote code execution on the application server.</p>',
      },
    ],
    references: [
      'OWASP Cheat Sheet: Software Supply Chain Security',
      'OWASP Cheat Sheet: Secure build and deployment',
      'OWASP Cheat Sheet: Infrastructure as Code',
      'OWASP Cheat Sheet: Deserialization',
      'SAFECode Software Integrity Controls',
      "A 'Worst Nightmare' Cyberattack: The Untold Story Of The SolarWinds Hack",
      'CodeCov Bash Uploader Compromise',
      'Securing DevOps by Julien Vehent',
    ],
    mappedCwes: [
      'CWE-345',
      'CWE-353',
      'CWE-426',
      'CWE-494',
      'CWE-502',
      'CWE-565',
      'CWE-784',
      'CWE-829',
      'CWE-830',
      'CWE-915',
    ],
  },
  A09: {
    id: 'A09',
    code: 'A09:2021',
    title: 'Security Logging and Monitoring Failures',
    url: 'https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/',
    brief:
      'Without logging, monitoring and alerting, breaches are neither detected nor answered in time: logins and high-value transactions are not logged, logs are kept only locally or in an unusable format, and alert thresholds or response processes are missing.',
    keyPrevention: [
      'Log login, access control and input validation failures with enough user context.',
      'Produce logs in a format that log management solutions can consume, encoded against injection.',
      'Keep a tamper-evident audit trail for high-value transactions.',
      'Set up monitoring, alerting and an incident response plan.',
    ],
    summary:
      'A09:2021-Security Logging and Monitoring Failures was previously Insufficient Logging & Monitoring and is added from the industry survey (#3), moving up from #10 previously. This category is expanded to include more types of failures, is challenging to test for, and isn’t well represented in the CVE/CVSS data. However, failures in this category can directly impact visibility, incident alerting, and forensics.',
    factors: {
      cwesMapped: 4,
      maxIncidenceRate: '19.23%',
      avgIncidenceRate: '6.51%',
      avgWeightedExploit: 6.87,
      avgWeightedImpact: 4.99,
      maxCoverage: '53.67%',
      avgCoverage: '39.97%',
      totalOccurrences: '53,615',
      totalCves: '242',
    },
    overview:
      "Security logging and monitoring came from the Top 10 community survey (#3), up slightly from the tenth position in the OWASP Top 10 2017. Logging and monitoring can be challenging to test, often involving interviews or asking if attacks were detected during a penetration test. There isn't much CVE/CVSS data for this category, but detecting and responding to breaches is critical. Still, it can be very impactful for accountability, visibility, incident alerting, and forensics. This category expands beyond CWE-778 Insufficient Logging to include CWE-117 Improper Output Neutralization for Logs, CWE-223 Omission of Security-relevant Information, and CWE-532 Insertion of Sensitive Information into Log File.",
    description: `
      <p>Returning to the OWASP Top 10 2021, this category is to help detect, escalate, and respond to active breaches. Without logging and monitoring, breaches cannot be detected. Insufficient logging, detection, monitoring, and active response occurs any time:</p>
      <ul>
        <li>Auditable events, such as logins, failed logins, and high-value transactions, are not logged.</li>
        <li>Warnings and errors generate no, inadequate, or unclear log messages.</li>
        <li>Logs of applications and APIs are not monitored for suspicious activity.</li>
        <li>Logs are only stored locally.</li>
        <li>Appropriate alerting thresholds and response escalation processes are not in place or effective.</li>
        <li>Penetration testing and scans by dynamic application security testing (DAST) tools (such as OWASP ZAP) do not trigger alerts.</li>
        <li>The application cannot detect, escalate, or alert for active attacks in real-time or near real-time.</li>
      </ul>
      <p>You are vulnerable to information leakage by making logging and alerting events visible to a user or an attacker (see A01:2021-Broken Access Control).</p>
      <p>You are vulnerable to injections or attacks on the logging or monitoring systems if log data is not correctly encoded.</p>
    `,
    howToPrevent: `
      <p>Developers should implement some or all the following controls, depending on the risk of the application:</p>
      <ul>
        <li>Ensure all login, access control, and server-side input validation failures can be logged with sufficient user context to identify suspicious or malicious accounts and held for enough time to allow delayed forensic analysis.</li>
        <li>Ensure that logs are generated in a format that log management solutions can easily consume.</li>
        <li>Ensure log data is encoded correctly to prevent injections or attacks on the logging or monitoring systems.</li>
        <li>Ensure high-value transactions have an audit trail with integrity controls to prevent tampering or deletion, such as append-only database tables or similar.</li>
        <li>DevSecOps teams should establish effective monitoring and alerting such that suspicious activities are detected and responded to quickly.</li>
        <li>Establish or adopt an incident response and recovery plan, such as National Institute of Standards and Technology (NIST) 800-61r2 or later.</li>
      </ul>
      <p>There are commercial and open-source application protection frameworks such as the OWASP ModSecurity Core Rule Set, and open-source log correlation software, such as the Elasticsearch, Logstash, Kibana (ELK) stack, that feature custom dashboards and alerting.</p>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1',
        description:
          "<p>A children's health plan provider's website operator couldn't detect a breach due to a lack of monitoring and logging. An external party informed the health plan provider that an attacker had accessed and modified thousands of sensitive health records of more than 3.5 million children. A post-incident review found that the website developers had not addressed significant vulnerabilities. As there was no logging or monitoring of the system, the data breach could have been in progress since 2013, a period of more than seven years.</p>",
      },
      {
        scenario: 'Scenario #2',
        description:
          "<p>A major Indian airline had a data breach involving more than ten years' worth of personal data of millions of passengers, including passport and credit card data. The data breach occurred at a third-party cloud hosting provider, who notified the airline of the breach after some time.</p>",
      },
      {
        scenario: 'Scenario #3',
        description:
          '<p>A major European airline suffered a GDPR reportable breach. The breach was reportedly caused by payment application security vulnerabilities exploited by attackers, who harvested more than 400,000 customer payment records. The airline was fined 20 million pounds as a result by the privacy regulator.</p>',
      },
    ],
    references: [
      'OWASP Proactive Controls: Implement Logging and Monitoring',
      'OWASP Application Security Verification Standard: V7 Logging and Monitoring',
      'OWASP Testing Guide: Testing for Detailed Error Code',
      'OWASP Cheat Sheet: Application Logging Vocabulary',
      'OWASP Cheat Sheet: Logging',
      'Data Integrity: Recovering from Ransomware and Other Destructive Events',
      'Data Integrity: Identifying and Protecting Assets Against Ransomware and Other Destructive Events',
      'Data Integrity: Detecting and Responding to Ransomware and Other Destructive Events',
    ],
    mappedCwes: ['CWE-117', 'CWE-223', 'CWE-532', 'CWE-778'],
  },
  A10: {
    id: 'A10',
    code: 'A10:2021',
    title: 'Server-Side Request Forgery (SSRF)',
    url: 'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
    brief:
      'Server-side request forgery (SSRF) occurs when an application fetches a remote resource from a user-supplied URL without validating it, letting an attacker make the server send requests to unexpected destinations, including internal services behind firewalls.',
    keyPrevention: [
      'Validate and sanitise every client-supplied URL.',
      'Enforce an allow-list of URL schemes, ports and destinations.',
      'Do not return raw responses to clients, and disable HTTP redirections.',
      'Isolate remote resource access in separate networks with deny-by-default firewall rules.',
    ],
    summary:
      'A10:2021-Server-Side Request Forgery is added from the Top 10 community survey (#1). The data shows a relatively low incidence rate with above average testing coverage, along with above-average ratings for Exploit and Impact potential. This category represents the scenario where the security community members are telling us this is important, even though it’s not illustrated in the data at this time.',
    factors: {
      cwesMapped: 1,
      maxIncidenceRate: '2.72%',
      avgIncidenceRate: '2.72%',
      avgWeightedExploit: 8.28,
      avgWeightedImpact: 6.72,
      maxCoverage: '67.72%',
      avgCoverage: '67.72%',
      totalOccurrences: '9,503',
      totalCves: '385',
    },
    overview:
      'This category is added from the Top 10 community survey (#1). The data shows a relatively low incidence rate with above average testing coverage and above-average Exploit and Impact potential ratings. As new entries are likely to be a single or small cluster of Common Weakness Enumerations (CWEs) for attention and awareness, the hope is that they are subject to focus and can be rolled into a larger category in a future edition.',
    description: `
      <p>SSRF flaws occur whenever a web application is fetching a remote resource without validating the user-supplied URL. It allows an attacker to coerce the application to send a crafted request to an unexpected destination, even when protected by a firewall, VPN, or another type of network access control list (ACL).</p>
      <p>As modern web applications provide end-users with convenient features, fetching a URL becomes a common scenario. As a result, the incidence of SSRF is increasing. Also, the severity of SSRF is becoming higher due to cloud services and the complexity of architectures.</p>
    `,
    howToPrevent: `
      <p>Developers can prevent SSRF by implementing some or all the following defense in depth controls:</p>
      
      <h3>From Network layer</h3>
      <ul>
        <li>Segment remote resource access functionality in separate networks to reduce the impact of SSRF</li>
        <li>Enforce “deny by default” firewall policies or network access control rules to block all but essential intranet traffic.<br>
        <em>Hints:</em>
        <ul>
          <li>~ Establish an ownership and a lifecycle for firewall rules based on applications.</li>
          <li>~ Log all accepted and blocked network flows on firewalls (see A09:2021-Security Logging and Monitoring Failures).</li>
        </ul>
        </li>
      </ul>
      
      <h3>From Application layer:</h3>
      <ul>
        <li>Sanitize and validate all client-supplied input data</li>
        <li>Enforce the URL schema, port, and destination with a positive allow list</li>
        <li>Do not send raw responses to clients</li>
        <li>Disable HTTP redirections</li>
        <li>Be aware of the URL consistency to avoid attacks such as DNS rebinding and “time of check, time of use” (TOCTOU) race conditions</li>
      </ul>
      <p>Do not mitigate SSRF via the use of a deny list or regular expression. Attackers have payload lists, tools, and skills to bypass deny lists.</p>
      
      <h3>Additional Measures to consider:</h3>
      <ul>
        <li>Don't deploy other security relevant services on front systems (e.g. OpenID). Control local traffic on these systems (e.g. localhost)</li>
        <li>For frontends with dedicated and manageable user groups use network encryption (e.g. VPNs) on independent systems to consider very high protection needs</li>
      </ul>
    `,
    exampleAttackScenarios: [
      {
        scenario: 'Scenario #1: Port scan internal servers',
        description:
          '<p>If the network architecture is unsegmented, attackers can map out internal networks and determine if ports are open or closed on internal servers from connection results or elapsed time to connect or reject SSRF payload connections.</p>',
      },
      {
        scenario: 'Scenario #2: Sensitive data exposure',
        description:
          '<p>Attackers can access local files or internal services to gain sensitive information such as <pre><code>file:///etc/passwd</code></pre> and <pre><code>http://localhost:28017/</code></pre>.</p>',
      },
      {
        scenario: 'Scenario #3: Access metadata storage of cloud services',
        description:
          '<p>Most cloud providers have metadata storage such as <pre><code>http://169.254.169.254/</code></pre>. An attacker can read the metadata to gain sensitive information.</p>',
      },
      {
        scenario: 'Scenario #4: Compromise internal services',
        description:
          '<p>The attacker can abuse internal services to conduct further attacks such as Remote Code Execution (RCE) or Denial of Service (DoS).</p>',
      },
    ],
    references: [
      'OWASP - Server-Side Request Forgery Prevention Cheat Sheet',
      'PortSwigger - Server-side request forgery (SSRF)',
      'Acunetix - What is Server-Side Request Forgery (SSRF)?',
      'SSRF bible',
      'A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!',
    ],
    mappedCwes: ['CWE-918'],
  },
});
