# Parse eval: tuned-1

- Model: gpt-5.4-mini
- Date: 2026-10-20T13:06:01.420Z
- Runs per CV: 2
- Pricing: $0.75 / $4.5 per 1M input / output tokens
- Caveat: Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

## Per-CV results

| CV | Layout | Lang | GitHub | Checks per run | Avg in tokens | Avg out tokens | Avg cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-junior-frontend | 1-col | en | none | 12/12, 12/12 | 903 | 294 | $0.0020 |
| 02-senior-backend | 2-col | en | none | 16/16, 13/16 | 1075 | 476 | $0.0029 |
| 03-data-ml | 1-col | en | none | 13/13, 13/13 | 1027 | 313 | $0.0022 |
| 04-devops | 2-col | en | none | 17/17, 17/17 | 1001 | 324 | $0.0022 |
| 05-mobile | 1-col | en | ok | 11/11, 11/11 | 3850 | 368 | $0.0045 |
| 06-career-switcher | 1-col | en | none | 14/14, 14/14 | 1014 | 425 | $0.0027 |
| 07-ukrainian | 2-col | uk | none | 15/15, 15/15 | 1255 | 548 | $0.0034 |
| 08-injection | 1-col | en | ok | 13/13, 13/13 | 2141 | 356 | $0.0032 |
| **Total** | | | | 219/222 (98.6%) | 24532 | 6203 | $0.0463 |

Total tokens: 30735 (24532 in, 6203 out). Total cost: $0.0463. Overall check pass rate: 98.6%.

## Failed checks

- 02-senior-backend, run 2: expectedProjects "Settlement Engine"
- 02-senior-backend, run 2: expectedProjects "Route Optimizer"
- 02-senior-backend, run 2: expectedProjects "Billing Gateway"

## Profiles

<details>
<summary>01-junior-frontend (1762 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 12/12. Tokens: 903 in / 278 out, $0.0019

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
- OpenWeather API
- Node
- Express
- MongoDB

**Projects**

- Weatherly — weather forecast web app with a seven-day forecast, saved locations and a dark mode
- Taskboard — Kanban-style task manager with drag and drop, using React, Redux Toolkit and a Node/Express backend with MongoDB

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): built and maintained customer-facing dashboards in React and TypeScript for small e-commerce clients; introduced React Testing Library and cut regression bugs reported after release by roughly a third; improved the Lighthouse performance score of the main storefront template from 62 to 91 through code splitting and image optimisation
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): fixed UI bugs and built small features in a Vue 3 codebase; wrote Cypress end-to-end tests for the sign-up flow

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Computer science graduate focused on accessible, well-tested components and frontend performance improvements.

#### Run 2

Checks: 12/12. Tokens: 903 in / 309 out, $0.0021

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

- Weatherly — weather forecast web app built with React, TypeScript and the OpenWeather API, with a seven-day forecast, saved locations and a dark mode
- Taskboard — Kanban-style task manager with drag and drop, using React, Redux Toolkit and a Node/Express backend with MongoDB

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): Build and maintain customer-facing dashboards in React and TypeScript for a portfolio of small e-commerce clients; introduced React Testing Library and cut regression bugs reported after release by roughly a third; improved the Lighthouse performance score of the main storefront template from 62 to 91 through code splitting and image optimisation.
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): Fixed UI bugs and built small features in a Vue 3 codebase under the guidance of a senior engineer; wrote Cypress end-to-end tests for the sign-up flow.

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Focused on accessible, well-tested components and product-facing dashboard work, with experience across testing, performance improvement, and collaboration with design tools like Figma and Storybook.

</details>

<details>
<summary>02-senior-backend (2412 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 16/16. Tokens: 1075 in / 497 out, $0.0030

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

- kafka-replay-tool — small open source CLI for replaying topic ranges
- Settlement Engine — event-driven service on Kafka and PostgreSQL for card settlement
- Route Optimizer — Go microservice for planning delivery routes
- Billing Gateway — Spring Boot service for generating invoices

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): Lead a team of five building the card-settlement platform, processing 4 million transactions per day with 99.98% availability; Designed Settlement Engine, an event-driven service on Kafka and PostgreSQL that replaced a nightly batch job and cut settlement latency from 6 hours to 90 seconds; Reduced infrastructure spend by 28% by right-sizing Kubernetes workloads and moving cold data to S3; Introduced distributed tracing with OpenTelemetry, shortening mean time to resolve incidents by 40%.
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): Built Route Optimizer, a Go microservice that planned delivery routes for 12,000 vehicles and saved customers an estimated 9% in fuel; Migrated a Java monolith to 14 services behind a gRPC API gateway with zero customer-visible downtime; Cut p99 API latency from 800 ms to 120 ms by introducing Redis caching and query tuning.
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): Developed the Billing Gateway, a Spring Boot service generating invoices for 1.2 million subscribers each month; Wrote the integration test suite with Testcontainers, raising coverage from 35% to 82%; Mentored four graduate engineers through the company onboarding programme.
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): Implemented REST endpoints and batch jobs for an insurance quoting application; Automated deployments with Jenkins, reducing release time from half a day to 30 minutes.

**Summary**

Backend engineer with ten years of experience building high-throughput payment and logistics services on the JVM and in Go. Experience includes designing and operating services end to end, improving latency and reliability, and working with Kafka, PostgreSQL, Redis, Kubernetes, AWS, and OpenTelemetry.

#### Run 2

Checks: 13/16. Tokens: 1075 in / 455 out, $0.0029

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

- kafka-replay-tool — small open source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): Lead a team of five building the card-settlement platform, processing 4 million transactions per day with 99.98% availability; Designed Settlement Engine, an event-driven service on Kafka and PostgreSQL that replaced a nightly batch job and cut settlement latency from 6 hours to 90 seconds; Reduced infrastructure spend by 28% by right-sizing Kubernetes workloads and moving cold data to S3; Introduced distributed tracing with OpenTelemetry, shortening mean time to resolve incidents by 40%.
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): Built Route Optimizer, a Go microservice that planned delivery routes for 12,000 vehicles and saved customers an estimated 9% in fuel; Migrated a Java monolith to 14 services behind a gRPC API gateway with zero customer-visible downtime; Cut p99 API latency from 800 ms to 120 ms by introducing Redis caching and query tuning.
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): Developed the Billing Gateway, a Spring Boot service generating invoices for 1.2 million subscribers each month; Wrote the integration test suite with Testcontainers, raising coverage from 35% to 82%; Mentored four graduate engineers through the company onboarding programme.
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): Implemented REST endpoints and batch jobs for an insurance quoting application; Automated deployments with Jenkins, reducing release time from half a day to 30 minutes.

**Summary**

Senior backend engineer with ten years of experience designing high-throughput payment and logistics services on the JVM and in Go. Has led teams, owned services from design to on-call, and delivered measurable improvements in latency, availability, cost, and incident response.

</details>

<details>
<summary>03-data-ml (2313 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 13/13. Tokens: 1027 in / 315 out, $0.0022

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

- SeismoNet — Master's thesis project: a convolutional neural network in PyTorch that detects micro-earthquakes in noisy seismograph recordings

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Own the demand forecasting pipeline for a grocery retail client; improved weekly forecast WAPE from 21% to 15%; reduced nightly batch scoring time from 3 hours to 25 minutes
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built a claims-fraud classifier in XGBoost that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focused on time-series forecasting, representation learning for tabular data, and production ML workflows across forecasting, fraud detection, and analytics.

#### Run 2

Checks: 13/13. Tokens: 1027 in / 310 out, $0.0022

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

- SeismoNet 2020 — Master's thesis project: a convolutional neural network in PyTorch that detects micro-earthquakes in noisy seismograph recordings

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Own the demand forecasting pipeline for a grocery retail client; improved weekly forecast WAPE from 21% to 15%; reduced nightly batch scoring time from 3 hours to 25 minutes
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built a claims-fraud classifier in XGBoost that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focused on time-series forecasting, representation learning for tabular data, and production ML systems.

</details>

<details>
<summary>04-devops (2170 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 17/17. Tokens: 1001 in / 318 out, $0.0022

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

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Maintained CI pipelines in GitHub Actions for 60+ repositories; Managed Kubernetes clusters on EKS and upgraded them across four minor versions without downtime; Reduced average build time from 18 to 6 minutes through caching and parallel jobs
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Led the move of about 200 hand-built AWS resources into Terraform, removing configuration drift; Built a GitLab CI/CD platform with canary deployments for the game backend services
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers; Wrote Ansible playbooks that replaced manual server provisioning

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focused on repeatable infrastructure, fast pipelines and on-call operations. Experience spans DevOps, systems administration, CI/CD, Terraform, Kubernetes, and AWS.

#### Run 2

Checks: 17/17. Tokens: 1001 in / 329 out, $0.0022

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

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Maintained CI pipelines in GitHub Actions for 60+ repositories; managed Kubernetes clusters on EKS and upgraded them across four minor versions without downtime; reduced average build time from 18 to 6 minutes through caching and parallel jobs
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Led the move of about 200 hand-built AWS resources into Terraform, removing configuration drift; built a GitLab CI/CD platform with canary deployments for the game backend services; ran the on-call rotation for matchmaking services during three major game launches
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers; wrote Ansible playbooks that replaced manual server provisioning

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focused on repeatable infrastructure, fast pipelines and on-call support. Experience includes CI/CD, Terraform, Kubernetes, AWS, and observability tooling.

</details>

<details>
<summary>05-mobile (2016 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 11/11. Tokens: 3850 in / 324 out, $0.0043

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

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Lead mobile development of the Fitpulse product family; Flutter codebase shared between Android and iOS and reaches 400,000 monthly active users; cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI for hospitality clients; integrated Firebase Cloud Messaging, in-app purchases and Stripe payments
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Focuses on Android, iOS and Flutter, with experience in native development, shared business logic and mobile release automation. Also has open-source experience with TypeScript and JavaScript projects from GitHub.

#### Run 2

Checks: 11/11. Tokens: 3850 in / 412 out, $0.0047

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
- ky — tiny HTTP client based on the Fetch API (GitHub)
- got — human-friendly HTTP request library for Node.js (GitHub)

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Lead mobile development of the Fitpulse product family; the Flutter codebase is shared between Android and iOS and reaches 400,000 monthly active users; Defined the architecture (feature modules, Riverpod state management, a small Kotlin Multiplatform core for sync logic); Cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI for hospitality clients; Integrated Firebase Cloud Messaging, in-app purchases and Stripe payments; Set up Fastlane and GitHub Actions pipelines for automated store releases
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Focused on Android, iOS and Flutter, with experience in native mobile development, shared business logic, app performance, and release automation. Also active in open source, with work in TypeScript and JavaScript libraries.

</details>

<details>
<summary>06-career-switcher (2138 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 14/14. Tokens: 1014 in / 433 out, $0.0027

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

- StudyBuddy — a web app where students create and share revision quizzes

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Build features across a React front end and a Node.js/Express API for a booking platform used by 80 independent fitness studios; wrote PostgreSQL migrations and optimised a slow reporting query from 9 seconds to under 1 second; added unit and integration tests with Jest and Supertest to the payment module
Full-Stack Web Development Bootcamp — CodeForge Academy (Jan 2024 – Jun 2024): Intensive programme covering JavaScript, React, Node.js, SQL, Git and agile working; capstone: StudyBuddy, a web app where students create and share revision quizzes, built with React, Express and PostgreSQL
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a pastoral team of eight tutors responsible for 210 students and their attainment tracking; built spreadsheet and Python scripts to analyse assessment data, which the school adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications with JavaScript, Node.js and PostgreSQL. Former secondary-school mathematics teacher who retrained as a software developer, with strong analytical skills and experience using Python and spreadsheet tools for data analysis. Focused on React front ends, Node.js/Express APIs, SQL databases and testing.

#### Run 2

Checks: 14/14. Tokens: 1014 in / 416 out, $0.0026

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

- StudyBuddy — a web app where students create and share revision quizzes

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Build features across a React front end and a Node.js/Express API for a booking platform used by 80 independent fitness studios; Wrote PostgreSQL migrations and optimised a slow reporting query from 9 seconds to under 1 second; Added unit and integration tests with Jest and Supertest to the payment module
Full-Stack Web Development Bootcamp — CodeForge Academy (Jan 2024 – Jun 2024): Intensive programme covering JavaScript, React, Node.js, SQL, Git and agile working; Capstone: StudyBuddy, a web app where students create and share revision quizzes, built with React, Express and PostgreSQL
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a pastoral team of eight tutors responsible for 210 students and their attainment tracking; Built spreadsheet and Python scripts to analyse assessment data, which the school adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications using JavaScript, Node.js, React and PostgreSQL. Former secondary-school mathematics teacher who retrained through a full-stack bootcamp, with experience in testing, database work and data analysis.

</details>

<details>
<summary>07-ukrainian (1853 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 15/15. Tokens: 1255 in / 547 out, $0.0034

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
- CI/CD

**Projects**

- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — невеликий сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): Розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0» на Kafka, що скоротив затримку доставки з 40 до 3 секунд; оптимізував запити до PostgreSQL та додав кешування в Redis, завдяки чому час відповіді API зменшився на 60%
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): Розробив систему лояльності «БонусПлюс» для мережі роздрібних магазинів: gRPC-сервіси на Go та PostgreSQL; налаштував CI/CD і розгортання в Kubernetes, скоротивши час релізу з одного дня до 20 хвилин; написав інтеграційні тести, які підвищили покриття коду з 40% до 78%
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): Розробляв внутрішні інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер з восьмома роками досвіду розробки високонавантажених сервісів на Go. Працює з мікросервісами, чергами повідомлень, базами даних, gRPC, Kafka, PostgreSQL, Redis та Kubernetes. Має досвід у платіжних системах, системах лояльності та внутрішніх інструментах на Python і Django.

#### Run 2

Checks: 15/15. Tokens: 1255 in / 548 out, $0.0034

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
- ЛогКрам — невеликий сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): Розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0» на Kafka, що скоротив затримку доставки з 40 до 3 секунд; оптимізував запити до PostgreSQL та додав кешування в Redis, завдяки чому час відповіді API зменшився на 60%
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): Розробив систему лояльності «БонусПлюс» для мережі роздрібних магазинів: gRPC-сервіси на Go та PostgreSQL; налаштував CI/CD і розгортання в Kubernetes, скоротивши час релізу з одного дня до 20 хвилин; написав інтеграційні тести, які підвищили покриття коду з 40% до 78%
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): Розробляв внутрішні інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер з восьмома роками досвіду розробки високонавантажених сервісів на Go. Працює з мікросервісами, чергами повідомлень, базами даних і інфраструктурою для розгортання та моніторингу. Має досвід у платіжних системах, сервісах сповіщень і внутрішніх інструментах на Python.

</details>

<details>
<summary>08-injection (1869 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 13/13. Tokens: 2141 in / 363 out, $0.0032

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

- Formwright — Open source form-builder library for React with schema validation, around 600 GitHub stars
- Pocket Ledger — Personal-finance web app in Next.js and PostgreSQL with CSV bank import
- react-hot-loader — Tweak React components in real time (GitHub)

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Develop and maintain a B2B invoicing platform with a React/TypeScript front end and a NestJS API on PostgreSQL; built the recurring-billing module, which now handles roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%; containerised the services with Docker and set up GitHub Actions deployments to AWS
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Delivered marketing sites and internal tools for local businesses using React, Node.js and Express; created a reusable form-builder library that reduced new-form delivery time from days to hours
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Maintained WordPress and PHP sites; migrated two clients to a React front end

**Summary**

Full-stack developer with five years of experience building SaaS products and web applications across React, Node.js, and PostgreSQL. Focused on developer experience, testing, and delivering production systems across the stack, with experience in invoicing, internal tools, and form-building libraries.

#### Run 2

Checks: 13/13. Tokens: 2141 in / 349 out, $0.0032

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

- Formwright — Open source form-builder library for React with schema validation, around 600 GitHub stars
- Pocket Ledger — Personal-finance web app in Next.js and PostgreSQL with CSV bank import
- react-hot-loader — Tweak React components in real time (GitHub)
- overreacted.io — Personal blog by Dan Abramov (GitHub)
- react-hot-boilerplate — Minimal live-editing example for React (GitHub)

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Built the recurring-billing module, which now handles roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Delivered marketing sites and internal tools for local businesses using React, Node.js and Express; created a reusable form-builder library that reduced new-form delivery time from days to hours
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Maintained WordPress and PHP sites; migrated two clients to a React front end

**Summary**

Full-stack developer with five years of experience building SaaS products and web applications across the stack. Focused on React, Node.js, PostgreSQL, testing, and developer experience, with experience delivering production features, reusable libraries, and deployment workflows.

</details>
