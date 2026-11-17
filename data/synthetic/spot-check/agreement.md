# Spot-check agreement

Pairs labelled: 30

- Exact band agreement: 76.7%
- Cohen's kappa (unweighted): 0.650
- Cohen's kappa (quadratic weights): 0.829

## Confusion matrix (rows: rule, columns: Dude)

| rule \ human | strong | partial | weak |
| ------------ | -----: | ------: | ---: |
| strong       |      7 |       3 |    0 |
| partial      |      1 |       6 |    3 |
| weak         |      0 |       0 |   10 |

## Disagreements (7)

### Pair 5: p040 x ml

Rule: partial (score 40), Dude: weak

- ml-exp: not_met - 2+ years of experience in machine learning
- ml-python: met (python) - 3+ years of Python experience
- ml-framework: not_met - 2+ years building deep learning models with PyTorch or TensorFlow
- ml-classic: not_met - Experience with classical machine learning using scikit-learn or pandas
- ml-domain: not_met - Experience working in NLP, computer vision or LLMs
- ml-mlops: not_met - Exposure to experiment tracking or MLOps with MLflow
- ml-docker: met (docker) - Docker experience
- ml-cloud: met (aws) - Experience with a major cloud provider such as AWS, GCP or Azure
- ml-sql: met (sql) - Working knowledge of SQL
- ml-git: met (git) - Comfort using Git

### Pair 11: p013 x mobile

Rule: partial (score 56), Dude: weak

- mo-exp: not_met - 3+ years of mobile development experience
- mo-platform: not_met - 2+ years building production apps on Android or iOS or React Native or Flutter
- mo-lang: met (typescript) - Hands-on experience with Kotlin or Swift or Dart or TypeScript
- mo-ui: not_met - Experience with a modern declarative UI toolkit such as Jetpack Compose or SwiftUI or React Native or Flutter
- mo-api: met (rest-api) - Experience integrating REST APIs
- mo-git: met (git) - Comfortable working with Git
- mo-test: met (junit) - Experience with unit testing using JUnit or Jest
- mo-cicd: met (ci-cd) - Exposure to mobile CI/CD
- mo-graphql: not_met - Experience with GraphQL clients
- mo-agile: met (agile) - Experience working in Agile teams

### Pair 12: p055 x data-engineering

Rule: strong (score 80), Dude: partial

- de-exp: met (exp-data) - 3+ years of experience in data engineering
- de-python: met (python) - 3+ years of experience working with Python for data processing
- de-sql: met (sql) - 3+ years of experience writing advanced SQL
- de-orchestration: met (airflow) - Hands-on experience with pipeline tooling such as Airflow, dbt or Spark
- de-warehouse: met (bigquery) - Experience working with a cloud data warehouse such as Snowflake or BigQuery
- de-streaming: not_met - Exposure to streaming with Kafka or Spark
- de-modeling: met (data-modeling) - Experience with data modeling or ETL design
- de-cloud: not_met - Familiarity with a major cloud provider such as AWS, GCP or Azure
- de-docker: not_met - Experience using Docker
- de-git: met (git) - Experience using Git

### Pair 19: p095 x full-stack

Rule: strong (score 88), Dude: partial

- fs-exp-be: met (exp-backend) - 2+ years of backend development experience
- fs-exp-fe: met (exp-frontend) - 2+ years of frontend development experience
- fs-ts: met (typescript) - TypeScript across the stack
- fs-ui: met (vue) - Experience with a modern UI framework such as React or Vue or Angular
- fs-server: met (nodejs) - Experience with a server-side language such as Node.js or Java or Python or Go
- fs-db: met (postgresql) - Experience with PostgreSQL or MySQL or MongoDB
- fs-docker: met (docker) - Docker for development and deployment
- fs-ci: not_met - Experience with CI/CD or GitHub Actions
- fs-cloud: not_met - Familiarity with a major cloud provider such as AWS or GCP or Azure
- fs-test: met (jest) - Experience with Jest or Cypress or Playwright

### Pair 22: p099 x security

Rule: strong (score 100), Dude: partial

- se-exp: met (exp-security) - 3+ years in security engineering
- se-owasp: met (owasp) - Experience with application security and the OWASP Top 10
- se-pentest: met (penetration-testing) - Hands-on experience with penetration testing or threat modeling
- se-iam: met (oauth) - Strong understanding of IAM or OAuth for identity and access management
- se-cloud: met (azure) - Cloud security experience with AWS or Azure or GCP
- se-linux: met (linux) - Experience hardening Linux systems
- se-siem: met (siem) - Exposure to SIEM and log analysis
- se-script: met (python) - Scripting skills in Python or Bash
- se-crypto: met (cryptography) - Familiarity with applied cryptography and TLS
- se-burp: met (burp-suite) - Working knowledge of Burp Suite
- se-ci: met (ci-cd) - Experience adding security checks in CI/CD

### Pair 23: p005 x backend-node

Rule: partial (score 47), Dude: weak

- bn-exp: not_met - 3+ years of backend development experience
- bn-node: partial (nodejs) - 2+ years of production experience with Node.js
- bn-ts: not_met - 2+ years of server-side experience with TypeScript
- bn-api: met (rest-api) - Experience designing REST APIs or GraphQL APIs
- bn-db: met (postgresql) - Experience working with PostgreSQL or MySQL or MongoDB
- bn-framework: not_met - Familiarity with NestJS or Express
- bn-cache: not_met - Experience with Redis for caching
- bn-docker: met (docker) - Comfort using Docker for local development and deployment
- bn-messaging: not_met - Exposure to Kafka or RabbitMQ message queues
- bn-tests: met (jest) - Experience writing automated tests with Jest

### Pair 27: p014 x qa-automation

Rule: partial (score 53), Dude: strong

- qa-exp: met (exp-qa) - 3+ years of experience in QA automation
- qa-ui: met (selenium) - 2+ years using Selenium or Cypress or Playwright for UI automation
- qa-lang: met (javascript) - Experience with JavaScript or TypeScript or Python or Java for test scripting
- qa-framework: met (test-automation) - Experience building test automation frameworks
- qa-api: not_met - Experience testing REST APIs with Postman or REST
- qa-cicd: not_met - Experience running test suites in CI/CD or GitHub Actions
- qa-pytest: not_met - Experience with pytest
- qa-perf: met (performance-testing) - Experience with performance testing
- qa-bdd: not_met - Experience with Cucumber for BDD
- qa-agile: not_met - Experience working in Agile teams
- qa-docker: not_met - Experience with Docker
