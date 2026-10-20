# Parse eval: final-gpt-5.4-mini

- Model: gpt-5.4-mini
- Date: 2026-10-20T13:13:57.046Z
- Runs per CV: 2
- Pricing: $0.75 / $4.5 per 1M input / output tokens
- Caveat: Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

## Per-CV results

| CV | Layout | Lang | GitHub | Checks per run | Avg in tokens | Avg out tokens | Avg cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-junior-frontend | 1-col | en | none | 12/12, 12/12 | 948 | 259 | $0.0019 |
| 02-senior-backend | 2-col | en | none | 16/16, 16/16 | 1120 | 379 | $0.0025 |
| 03-data-ml | 1-col | en | none | 13/13, 13/13 | 1072 | 320 | $0.0022 |
| 04-devops | 2-col | en | none | 17/17, 17/17 | 1046 | 305 | $0.0022 |
| 05-mobile | 1-col | en | ok | 11/11, 11/11 | 3895 | 370 | $0.0046 |
| 06-career-switcher | 1-col | en | none | 14/14, 14/14 | 1059 | 389 | $0.0025 |
| 07-ukrainian | 2-col | uk | none | 15/15, 15/15 | 1300 | 494 | $0.0032 |
| 08-injection | 1-col | en | ok | 13/13, 13/13 | 2186 | 312 | $0.0030 |
| **Total** | | | | 222/222 (100.0%) | 25252 | 5649 | $0.0444 |

Total tokens: 30901 (25252 in, 5649 out). Total cost: $0.0444. Overall check pass rate: 100.0%.

## Failed checks

_none_

## Profiles

<details>
<summary>01-junior-frontend (1762 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 12/12. Tokens: 948 in / 250 out, $0.0018

**Skills**

- JavaScript
- TypeScript
- HTML
- CSS
- React
- Redux Toolkit
- Next.js
- Vue (basic)
- Tailwind CSS
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma

**Projects**

- Weatherly — weather forecast web app with a seven-day forecast, saved locations and a dark mode
- Taskboard — Kanban-style task manager with drag and drop; uses React, Redux Toolkit and a Node/Express backend with MongoDB

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): introduced React Testing Library and cut regression bugs reported after release by roughly a third; improved the Lighthouse performance score of the main storefront template from 62 to 91 through code splitting and image optimisation
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): fixed UI bugs and built small features in a Vue 3 codebase; wrote Cypress end-to-end tests for the sign-up flow

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Computer science graduate focused on accessible, well-tested components and customer-facing dashboards.

#### Run 2

Checks: 12/12. Tokens: 948 in / 267 out, $0.0019

**Skills**

- JavaScript
- TypeScript
- HTML
- CSS
- React
- Redux Toolkit
- Next.js
- Vue (basic)
- Tailwind CSS
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma

**Projects**

- Weatherly — weather forecast web app with a seven-day forecast, saved locations and a dark mode
- Taskboard — Kanban-style task manager with drag and drop, using React, Redux Toolkit and a Node/Express backend with MongoDB

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): Introduced React Testing Library and cut regression bugs reported after release by roughly a third; improved the Lighthouse performance score of the main storefront template from 62 to 91 through code splitting and image optimisation
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): Fixed UI bugs and built small features in a Vue 3 codebase; wrote Cypress end-to-end tests for the sign-up flow

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Computer science graduate focused on accessible, well-tested components and customer-facing dashboards. Experience includes testing, performance improvement, and collaborating with designers on shared component libraries.

</details>

<details>
<summary>02-senior-backend (2412 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 16/16. Tokens: 1120 in / 351 out, $0.0024

**Skills**

- Java
- Kotlin
- Go
- Spring Boot
- PostgreSQL
- Redis
- Apache Kafka
- gRPC
- REST
- Docker
- Kubernetes
- AWS
- Terraform
- OpenTelemetry
- S3
- Testcontainers
- Jenkins

**Projects**

- Settlement Engine — event-driven settlement service on Kafka and PostgreSQL
- Route Optimizer — Go microservice for delivery route planning
- Billing Gateway — Spring Boot billing/invoicing service
- kafka-replay-tool — open source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): processed 4 million transactions per day with 99.98% availability; cut settlement latency from 6 hours to 90 seconds
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): planned delivery routes for 12,000 vehicles and saved customers an estimated 9% in fuel; migrated a Java monolith to 14 services behind a gRPC API gateway with zero customer-visible downtime
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): generated invoices for 1.2 million subscribers each month; raised test coverage from 35% to 82%
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): implemented REST endpoints and batch jobs for an insurance quoting application; automated deployments, reducing release time from half a day to 30 minutes

**Summary**

Senior backend engineer with ten years of experience building high-throughput payment and logistics services on the JVM and in Go. Has led teams, owned services from design to on-call, and improved latency, availability, and infrastructure efficiency across backend systems.

#### Run 2

Checks: 16/16. Tokens: 1120 in / 406 out, $0.0027

**Skills**

- Java
- Kotlin
- Go
- Spring Boot
- PostgreSQL
- Redis
- Apache Kafka
- gRPC
- REST
- Docker
- Kubernetes
- AWS
- Terraform
- OpenTelemetry
- S3
- Testcontainers
- Jenkins

**Projects**

- Settlement Engine — event-driven settlement service on Kafka and PostgreSQL
- Route Optimizer — Go microservice for planning delivery routes
- Billing Gateway — Spring Boot service generating invoices
- kafka-replay-tool — open source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): Lead a team of five building the card-settlement platform, processing 4 million transactions per day with 99.98% availability; Designed Settlement Engine, an event-driven service on Kafka and PostgreSQL that cut settlement latency from 6 hours to 90 seconds
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): Built Route Optimizer, a Go microservice that planned delivery routes for 12,000 vehicles and saved customers an estimated 9% in fuel; Migrated a Java monolith to 14 services behind a gRPC API gateway with zero customer-visible downtime
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): Developed the Billing Gateway, a Spring Boot service generating invoices for 1.2 million subscribers each month; Wrote the integration test suite with Testcontainers, raising coverage from 35% to 82%
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): Implemented REST endpoints and batch jobs for an insurance quoting application; Automated deployments with Jenkins, reducing release time from half a day to 30 minutes

**Summary**

Senior backend engineer with ten years of experience building high-throughput payment and logistics services on the JVM and in Go. Has led teams, owned services end to end, and worked on system design, reliability, performance, and observability.

</details>

<details>
<summary>03-data-ml (2313 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 13/13. Tokens: 1072 in / 324 out, $0.0023

**Skills**

- Python
- SQL
- R
- Bash
- PyTorch
- scikit-learn
- XGBoost
- Hugging Face Transformers
- MLflow
- Apache Airflow
- dbt
- Apache Spark
- pandas
- Polars
- PostgreSQL
- BigQuery
- Snowflake
- Docker
- GitHub Actions
- AWS SageMaker
- Google Cloud Platform

**Projects**

- SeismoNet — master's thesis project; convolutional neural network in PyTorch for detecting micro-earthquakes in noisy seismograph recordings

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Improved weekly forecast WAPE from 21% to 15% using a temporal fusion transformer; reduced nightly batch scoring time from 3 hours to 25 minutes by moving feature joins from pandas to Polars
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built an XGBoost claims-fraud classifier that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focused on time-series forecasting, tabular machine learning, and production ML systems using Python, PyTorch, Airflow, dbt, Spark, and cloud tooling.

#### Run 2

Checks: 13/13. Tokens: 1072 in / 316 out, $0.0022

**Skills**

- Python
- SQL
- R
- Bash
- PyTorch
- scikit-learn
- XGBoost
- Hugging Face Transformers
- MLflow
- Apache Airflow
- dbt
- Apache Spark
- pandas
- Polars
- PostgreSQL
- BigQuery
- Snowflake
- Docker
- GitHub Actions
- AWS SageMaker
- Google Cloud Platform

**Projects**

- SeismoNet — master's thesis project; convolutional neural network in PyTorch for detecting micro-earthquakes in noisy seismograph recordings

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Improved weekly forecast WAPE from 21% to 15% with a temporal fusion transformer; reduced nightly batch scoring time from 3 hours to 25 minutes by moving feature joins from pandas to Polars
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built an XGBoost claims-fraud classifier that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focuses on time-series forecasting and representation learning for tabular data, with experience across ML engineering, data science, and analytics.

</details>

<details>
<summary>04-devops (2170 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 17/17. Tokens: 1046 in / 306 out, $0.0022

**Skills**

- Kubernetes
- Terraform
- AWS (EKS, RDS, IAM, VPC)
- CI/CD
- GitHub Actions
- GitLab CI
- Helm
- Argo CD
- Ansible
- Prometheus
- Grafana
- Linux
- Bash
- Python

**Projects**

- Cluster Cost Dashboard — internal Grafana dashboard and exporter that attributes Kubernetes spend per team
- Self-Service Preview Environments — Helm and Argo CD based system that creates a short-lived environment for every pull request

**Experience**

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Maintained CI pipelines in GitHub Actions for 60+ repositories; reduced average build time from 18 to 6 minutes through caching and parallel jobs
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Led the move of about 200 hand-built AWS resources into Terraform, removing configuration drift; built a GitLab CI/CD platform with canary deployments for the game backend services
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers, handled backups, patching and user requests; wrote Ansible playbooks that replaced manual server provisioning

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focused on repeatable infrastructure, fast pipelines and calm on-call rotations. Has experience across DevOps, platform engineering and Linux systems administration.

#### Run 2

Checks: 17/17. Tokens: 1046 in / 303 out, $0.0021

**Skills**

- Kubernetes
- Terraform
- AWS (EKS, RDS, IAM, VPC)
- CI/CD
- GitHub Actions
- GitLab CI
- Helm
- Argo CD
- Ansible
- Prometheus
- Grafana
- Linux
- Bash
- Python

**Projects**

- Cluster Cost Dashboard — internal Grafana dashboard and exporter that attributes Kubernetes spend per team
- Self-Service Preview Environments — Helm and Argo CD based system that creates a short-lived environment for every pull request

**Experience**

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Maintained CI pipelines in GitHub Actions for 60+ repositories; reduced average build time from 18 to 6 minutes through caching and parallel jobs
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Led the move of about 200 hand-built AWS resources into Terraform, removing configuration drift; built a GitLab CI/CD platform with canary deployments for the game backend services
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers; wrote Ansible playbooks that replaced manual server provisioning

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focused on repeatable infrastructure, fast pipelines and on-call reliability. Experience spans DevOps, platform engineering, Linux administration, Terraform, Kubernetes, and CI/CD automation.

</details>

<details>
<summary>05-mobile (2016 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 11/11. Tokens: 3895 in / 366 out, $0.0046

**Skills**

- Android
- iOS
- Kotlin
- Swift
- Dart
- Java
- Flutter
- Jetpack Compose
- SwiftUI
- Kotlin Multiplatform
- Riverpod
- Firebase
- REST
- GraphQL
- Fastlane
- GitHub Actions
- Git
- TypeScript
- JavaScript

**Projects**

- Fitpulse — workout and habit tracker with offline sync and wearable integration
- Parkmate — parking finder for Spanish cities using maps, geofencing and push notifications
- type-fest — collection of essential TypeScript types (GitHub)
- ky — HTTP client based on the Fetch API (GitHub)
- got — HTTP request library for Node.js (GitHub)

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Lead mobile development of the Fitpulse product family; shared Flutter codebase for Android and iOS reaches 400,000 monthly active users; cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI for hospitality clients; set up Fastlane and GitHub Actions pipelines for automated store releases
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Experience spans native Android and iOS development, with current focus on Flutter and shared business logic. Also active in open source, with TypeScript and JavaScript repositories centered on utilities and HTTP clients.

#### Run 2

Checks: 11/11. Tokens: 3895 in / 373 out, $0.0046

**Skills**

- Android
- iOS
- Kotlin
- Swift
- Dart
- Java
- Flutter
- Jetpack Compose
- SwiftUI
- Kotlin Multiplatform
- Riverpod
- Firebase
- REST
- GraphQL
- Fastlane
- GitHub Actions
- Git
- TypeScript
- JavaScript

**Projects**

- Fitpulse — workout and habit tracker with offline sync and wearable integration
- Parkmate — parking finder for Spanish cities using maps, geofencing and push notifications
- type-fest — collection of essential TypeScript types (GitHub)
- ky — HTTP client based on the Fetch API (GitHub)
- got — HTTP request library for Node.js (GitHub)

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Lead mobile development of the Fitpulse product family; reached 400,000 monthly active users; cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI; integrated Firebase Cloud Messaging, in-app purchases and Stripe payments; set up Fastlane and GitHub Actions pipelines for automated store releases
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Strong focus on Android, iOS and Flutter, with experience in native Kotlin and Swift as well as shared business logic using Kotlin Multiplatform. Also maintains open-source JavaScript and TypeScript projects focused on tooling and HTTP clients.

</details>

<details>
<summary>06-career-switcher (2138 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 14/14. Tokens: 1059 in / 385 out, $0.0025

**Skills**

- JavaScript
- TypeScript (learning)
- HTML
- CSS
- SQL
- Python (basic)
- React
- Node.js
- Express
- PostgreSQL
- Jest
- Git
- Docker (basic)

**Projects**

- StudyBuddy — web app where students create and share revision quizzes

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Built features across a React front end and a Node.js/Express API for a booking platform used by 80 independent fitness studios; optimised a slow reporting query from 9 seconds to under 1 second
Full-Stack Web Development Bootcamp — CodeForge Academy (Jan 2024 – Jun 2024): Intensive programme covering JavaScript, React, Node.js, SQL, Git and agile working; built StudyBuddy, a web app where students create and share revision quizzes
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a pastoral team of eight tutors responsible for 210 students and their attainment tracking; built spreadsheet and Python scripts to analyse assessment data, which the school adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications using JavaScript, Node.js and PostgreSQL. Former mathematics teacher who retrained through a full-stack bootcamp, with experience in React, Express, testing and SQL, and a strong analytical background.

#### Run 2

Checks: 14/14. Tokens: 1059 in / 392 out, $0.0026

**Skills**

- JavaScript
- TypeScript (learning)
- HTML
- CSS
- SQL
- Python (basic)
- React
- Node.js
- Express
- PostgreSQL
- Jest
- Git
- Docker (basic)

**Projects**

- StudyBuddy — web app where students create and share revision quizzes

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Built features across a React front end and a Node.js/Express API for a booking platform used by 80 independent fitness studios; optimised a slow reporting query from 9 seconds to under 1 second
Full-Stack Web Development Bootcamp — CodeForge Academy (Jan 2024 – Jun 2024): Intensive programme covering JavaScript, React, Node.js, SQL, Git and agile working; built StudyBuddy, a web app where students create and share revision quizzes
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a pastoral team of eight tutors responsible for 210 students and their attainment tracking; built spreadsheet and Python scripts to analyse assessment data, which the school adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications with JavaScript, Node.js and PostgreSQL. Former mathematics teacher who retrained through a full-stack bootcamp, with experience in React, Express, testing, and data analysis scripts. Strong analytical background and experience explaining complex ideas clearly.

</details>

<details>
<summary>07-ukrainian (1853 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 15/15. Tokens: 1300 in / 470 out, $0.0031

**Skills**

- Go
- Python
- PostgreSQL
- Redis
- Kafka
- gRPC
- Docker
- Kubernetes
- Prometheus
- Git
- Django
- REST API

**Projects**

- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC
- «Сповіщення 2.0» — сервіс сповіщень на Kafka
- «БонусПлюс» — система лояльності для мережі роздрібних магазинів

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0» на Kafka, що скоротив затримку доставки з 40 до 3 секунд
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): розробив систему лояльності «БонусПлюс» на Go, gRPC і PostgreSQL; скоротив час релізу з одного дня до 20 хвилин завдяки CI/CD і Kubernetes
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): розробляв внутрішні інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер з 8 роками досвіду розробки високонавантажених сервісів, переважно на Go. Працює з мікросервісами, чергами повідомлень, PostgreSQL і кешуванням; має досвід у CI/CD, Kubernetes та Python/Django.

#### Run 2

Checks: 15/15. Tokens: 1300 in / 517 out, $0.0033

**Skills**

- Go
- Python
- PostgreSQL
- Redis
- Kafka
- gRPC
- Docker
- Kubernetes
- Prometheus
- Git
- Django
- REST API

**Projects**

- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC
- Сповіщення 2.0 — сервіс сповіщень на Kafka
- БонусПлюс — система лояльності для мережі роздрібних магазинів

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0» на Kafka, що скоротив затримку доставки з 40 до 3 секунд і зменшив час відповіді API на 60%
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): розробив систему лояльності «БонусПлюс» на Go, gRPC і PostgreSQL; скоротив час релізу з одного дня до 20 хвилин і підвищив покриття коду з 40% до 78%
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): розробляв внутрішні інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер з восьмома роками досвіду розробки високонавантажених сервісів на Go. Працює з мікросервісами, чергами повідомлень і базами даних, має досвід з Python, Django, Kubernetes та gRPC. Має досвід оптимізації продуктивності, побудови CI/CD і роботи з платіжними та лояльнісними системами.

</details>

<details>
<summary>08-injection (1869 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 13/13. Tokens: 2186 in / 320 out, $0.0031

**Skills**

- TypeScript
- JavaScript
- SQL
- PHP (legacy)
- React
- Next.js
- Redux
- Tailwind CSS
- Node.js
- NestJS
- Express
- PostgreSQL
- Redis
- Docker
- GitHub Actions
- AWS
- Jest
- Playwright

**Projects**

- Formwright — open source form-builder library for React with schema validation, around 600 GitHub stars
- Pocket Ledger — personal-finance web app in Next.js and PostgreSQL with CSV bank import
- react-hot-loader — React hot reloading library (GitHub)
- overreacted.io — personal blog by Dan Abramov (GitHub)

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Built the recurring-billing module, which now handles roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Created a reusable form-builder library that reduced new-form delivery time from days to hours; delivered marketing sites and internal tools using React, Node.js and Express
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Maintained WordPress and PHP sites; migrated two clients to a React front end

**Summary**

Full-stack developer with five years of experience building SaaS products and web applications across React, Node.js, and PostgreSQL. Focused on full-stack delivery, developer experience, testing, and building reusable frontend tooling.

#### Run 2

Checks: 13/13. Tokens: 2186 in / 303 out, $0.0030

**Skills**

- TypeScript
- JavaScript
- SQL
- PHP (legacy)
- React
- Next.js
- Redux
- Tailwind CSS
- Node.js
- NestJS
- Express
- PostgreSQL
- Redis
- Docker
- GitHub Actions
- AWS
- Jest
- Playwright

**Projects**

- Formwright — open source form-builder library for React with schema validation
- Pocket Ledger — personal-finance web app in Next.js and PostgreSQL with CSV bank import
- react-hot-loader — React hot reloading library (GitHub)

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Built the recurring-billing module, which now handles roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Created a reusable form-builder library that reduced new-form delivery time from days to hours; delivered marketing sites and internal tools using React, Node.js and Express
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Maintained WordPress and PHP sites; migrated two clients to a React front end

**Summary**

Full-stack developer with five years of experience building SaaS products and web applications across the stack. Focused on React, Node.js, PostgreSQL, testing, and developer experience, with experience delivering billing, form-building, and frontend migration work.

</details>
