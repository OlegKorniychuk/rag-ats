# Parse eval: final-gpt-6-luna

- Model: gpt-6-luna
- Date: 2026-10-20T13:12:54.080Z
- Runs per CV: 2
- Pricing: $0.1 / $0.5 per 1M input / output tokens
- Caveat: Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

## Per-CV results

| CV | Layout | Lang | GitHub | Checks per run | Avg in tokens | Avg out tokens | Avg cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-junior-frontend | 1-col | en | none | 12/12, 12/12 | 948 | 495 | $0.0003 |
| 02-senior-backend | 2-col | en | none | 16/16, 16/16 | 1120 | 784 | $0.0005 |
| 03-data-ml | 1-col | en | none | 13/13, 13/13 | 1072 | 480 | $0.0003 |
| 04-devops | 2-col | en | none | 17/17, 17/17 | 1046 | 474 | $0.0003 |
| 05-mobile | 1-col | en | ok | 11/11, 11/11 | 3895 | 902 | $0.0008 |
| 06-career-switcher | 1-col | en | none | 14/14, 14/14 | 1059 | 563 | $0.0004 |
| 07-ukrainian | 2-col | uk | none | 15/15, 15/15 | 1300 | 786 | $0.0005 |
| 08-injection | 1-col | en | ok | 13/13, 13/13 | 2186 | 882 | $0.0007 |
| **Total** | | | | 222/222 (100.0%) | 25252 | 10728 | $0.0079 |

Total tokens: 35980 (25252 in, 10728 out). Total cost: $0.0079. Overall check pass rate: 100.0%.

## Failed checks

_none_

## Profiles

<details>
<summary>01-junior-frontend (1762 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 12/12. Tokens: 948 in / 445 out, $0.0003

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
- Node.js
- Express
- MongoDB
- OpenWeather API
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma
- Code splitting
- Image optimisation

**Projects**

- Weatherly — Weather forecast web app built with React, TypeScript and the OpenWeather API, featuring a seven-day forecast, saved locations and dark mode.
- Taskboard — Kanban-style task manager with drag and drop, built with React, Redux Toolkit, Node/Express and MongoDB.

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): Introduced React Testing Library and cut regression bugs reported after release by roughly a third; improved the main storefront template’s Lighthouse performance score from 62 to 91 through code splitting and image optimisation.
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): Fixed UI bugs and built small features in a Vue 3 codebase; wrote Cypress end-to-end tests for the sign-up flow.

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces, primarily with React and TypeScript. Computer science graduate focused on accessible, well-tested components and improving web performance.

#### Run 2

Checks: 12/12. Tokens: 948 in / 545 out, $0.0004

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
- Node.js
- Express
- MongoDB
- OpenWeather API
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma
- Accessibility
- Code splitting
- Image optimisation
- End-to-end testing

**Projects**

- Weatherly — Weather forecast web app with a seven-day forecast, saved locations and dark mode, built with React, TypeScript and the OpenWeather API.
- Taskboard — Kanban-style task manager with drag and drop, built with React, Redux Toolkit, Node/Express and MongoDB.

**Experience**

Junior Frontend Developer — Pixelmint Studio (Jun 2024 – Present): Introduced React Testing Library, cutting post-release regression bugs by roughly a third; improved the main storefront template’s Lighthouse score from 62 to 91 through code splitting and image optimisation.
Frontend Intern — Brightloop Software (Jun 2023 – Aug 2023): Fixed UI bugs and built small features in a Vue 3 codebase; wrote Cypress end-to-end tests for the sign-up flow.

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Computer science graduate focused on accessible, well-tested components and translating designs into polished user interfaces.

</details>

<details>
<summary>02-senior-backend (2412 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 16/16. Tokens: 1120 in / 729 out, $0.0005

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
- S3
- Terraform
- OpenTelemetry
- Testcontainers
- Jenkins
- Event-driven architecture
- Distributed tracing
- Microservices
- Integration testing

**Projects**

- Settlement Engine — event-driven service on Kafka and PostgreSQL for card settlement
- Route Optimizer — Go microservice for planning delivery routes
- Billing Gateway — Spring Boot service for generating subscriber invoices
- kafka-replay-tool — open-source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): Led a team of five building a card-settlement platform processing 4 million transactions per day with 99.98% availability; designed Settlement Engine, replacing a nightly batch job and cutting settlement latency from 6 hours to 90 seconds
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): Built Route Optimizer for 12,000 vehicles, saving customers an estimated 9% in fuel; cut p99 API latency from 800 ms to 120 ms with Redis caching and query tuning
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): Developed Billing Gateway, generating invoices for 1.2 million subscribers each month; raised test coverage from 35% to 82% with an integration test suite
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): Automated deployments with Jenkins, reducing release time from half a day to 30 minutes

**Summary**

Backend engineer with ten years of experience designing high-throughput payment and logistics services using JVM technologies and Go. Senior-level focus on service design, reliability, performance, and end-to-end service ownership, with experience mentoring engineers.

#### Run 2

Checks: 16/16. Tokens: 1120 in / 838 out, $0.0005

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
- S3
- Terraform
- OpenTelemetry
- Testcontainers
- Jenkins
- Event-driven architecture
- Microservices
- Distributed tracing
- Integration testing
- Query tuning

**Projects**

- Settlement Engine — event-driven service on Kafka and PostgreSQL that replaced a nightly batch job
- Route Optimizer — Go microservice that planned delivery routes
- Billing Gateway — Spring Boot service generating subscriber invoices
- kafka-replay-tool — open-source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer — Ledgerly (Mar 2021 – Present): Built a card-settlement platform processing 4 million transactions per day with 99.98% availability; designed Settlement Engine, cutting settlement latency from 6 hours to 90 seconds
Backend Engineer — Cargowise Labs (Jan 2018 – Feb 2021): Built Route Optimizer for 12,000 vehicles, saving customers an estimated 9% in fuel; migrated a Java monolith to 14 services behind a gRPC API gateway with zero customer-visible downtime
Software Engineer — Brightwave Telecom (Sep 2015 – Dec 2017): Developed Billing Gateway, generating invoices for 1.2 million subscribers each month; raised test coverage from 35% to 82%
Junior Java Developer — Northgate Systems (Aug 2014 – Aug 2015): Automated deployments with Jenkins, reducing release time from half a day to 30 minutes

**Summary**

Senior backend engineer with ten years of experience designing high-throughput payment and logistics services on the JVM and in Go. Experienced in owning services from design through on-call and mentoring engineers.

</details>

<details>
<summary>03-data-ml (2313 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 13/13. Tokens: 1072 in / 534 out, $0.0004

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
- time-series forecasting
- representation learning
- A/B testing
- convolutional neural networks

**Projects**

- SeismoNet — Master's thesis project: a PyTorch convolutional neural network that detects micro-earthquakes in noisy seismograph recordings, outperforming the STA/LTA baseline by 12 points of F1.

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Improved weekly forecast WAPE from 21% to 15% by replacing a gradient boosting baseline with a temporal fusion transformer; reduced nightly batch scoring time from 3 hours to 25 minutes by moving feature joins from pandas to Polars.
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built an XGBoost claims-fraud classifier that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team.
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week.

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focuses on time-series forecasting and representation learning for tabular data.

#### Run 2

Checks: 13/13. Tokens: 1072 in / 425 out, $0.0003

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

- SeismoNet — Master's thesis project using a PyTorch convolutional neural network to detect micro-earthquakes in noisy seismograph recordings; outperformed the STA/LTA baseline by 12 points of F1.

**Experience**

Machine Learning Engineer — Quantaflow Analytics (Feb 2023 – Present): Replaced a gradient boosting baseline with a temporal fusion transformer, improving weekly forecast WAPE from 21% to 15%; reduced nightly batch scoring time from 3 hours to 25 minutes.
Data Scientist — Harborview Insurance Group (Sep 2021 – Jan 2023): Built an XGBoost claims-fraud classifier that surfaced 18% more fraudulent claims at the same investigator workload; wrote SQL models and dashboards used weekly by the actuarial team.
Junior Data Analyst — Lumen Retail (Jul 2020 – Aug 2021): Automated weekly sales reporting with Python and SQL, saving the team about 6 hours a week.

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Focuses on time-series forecasting and representation learning for tabular data.

</details>

<details>
<summary>04-devops (2170 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 17/17. Tokens: 1046 in / 426 out, $0.0003

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

- Cluster Cost Dashboard — Internal Grafana dashboard and exporter that attributes Kubernetes spend per team; led to a 22% cut in idle capacity.
- Self-Service Preview Environments — Helm- and Argo CD-based system that creates a short-lived environment for every pull request.

**Experience**

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Upgraded EKS clusters across four minor versions without downtime; reduced average build time from 18 to 6 minutes.
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Moved about 200 hand-built AWS resources into Terraform, removing configuration drift; built a GitLab CI/CD platform with canary deployments for game backend services.
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers; wrote Ansible playbooks that replaced manual server provisioning.

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focuses on repeatable infrastructure, fast pipelines and reliable operations.

#### Run 2

Checks: 17/17. Tokens: 1046 in / 522 out, $0.0004

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

- Cluster Cost Dashboard — Internal Grafana dashboard and exporter that attributes Kubernetes spend per team; led to a 22% cut in idle capacity.
- Self-Service Preview Environments — Helm and Argo CD based system that creates a short-lived environment for every pull request.

**Experience**

Senior DevOps Engineer — Stratus Commerce (Apr 2022 – Present): Reduced average build time from 18 to 6 minutes through caching and parallel jobs; upgraded EKS clusters across four minor versions without downtime.
DevOps Engineer — Nordlight Games (Feb 2019 – Mar 2022): Led the move of about 200 hand-built AWS resources into Terraform, removing configuration drift; built a GitLab CI/CD platform with canary deployments for game backend services.
Systems Administrator — Baltic Hosting (Jul 2017 – Jan 2019): Administered around 120 Linux servers; wrote Ansible playbooks that replaced manual server provisioning.

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Focused on repeatable infrastructure, fast CI pipelines, and production operations.

</details>

<details>
<summary>05-mobile (2016 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 11/11. Tokens: 3895 in / 772 out, $0.0008

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

- Fitpulse — workout and habit tracker with offline sync and wearable integration; over 400,000 monthly active users and a 4.7 average store rating.
- Parkmate — parking finder for Spanish cities using maps, geofencing and push notifications; 150,000 downloads.
- type-fest — collection of essential TypeScript types (GitHub).
- ky — JavaScript HTTP client based on the Fetch API (GitHub).
- got — HTTP request library for Node.js (GitHub).

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Leads development of Fitpulse, a Flutter codebase shared between Android and iOS that reaches 400,000 monthly active users; cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%.
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI; set up Fastlane and GitHub Actions pipelines for automated store releases.
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin.

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Senior mobile developer focused on Flutter products shared across Android and iOS, with experience in native Android and iOS development.

#### Run 2

Checks: 11/11. Tokens: 3895 in / 1032 out, $0.0009

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
- Shell
- CSS

**Projects**

- Fitpulse — workout and habit tracker with offline sync and wearable integration; over 400,000 monthly active users and a 4.7 average store rating.
- Parkmate — parking finder for Spanish cities using maps, geofencing and push notifications; 150,000 downloads.
- type-fest — collection of essential TypeScript types (GitHub)
- ky — JavaScript HTTP client based on the Fetch API (GitHub)
- got — HTTP request library for Node.js (GitHub)

**Experience**

Senior Mobile Developer — Orbita Apps (Jan 2022 – Present): Leads development of the Fitpulse product family, whose shared Flutter codebase reaches 400,000 monthly active users; cut app start time by 35% and reduced the crash-free-session gap from 1.8% to 0.4%.
iOS / Android Developer — Costa Digital (Mar 2019 – Dec 2021): Developed native Android apps in Kotlin with Jetpack Compose and native iOS apps in Swift with SwiftUI; set up Fastlane and GitHub Actions pipelines for automated store releases.
Junior Android Developer — Appiary (Sep 2018 – Feb 2019): Implemented screens and REST integrations for a ticketing app in Java and Kotlin.

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Senior mobile developer focused on Flutter for Android and iOS, with a background in native Android and iOS development and shared business logic.

</details>

<details>
<summary>06-career-switcher (2138 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 14/14. Tokens: 1059 in / 570 out, $0.0004

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
- Supertest
- Git
- Docker (basic)
- Agile

**Projects**

- StudyBuddy — Web app where students create and share revision quizzes, built with React, Express and PostgreSQL

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Build features for a booking platform used by 80 independent fitness studios; optimised a reporting query from 9 seconds to under 1 second
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a team of eight tutors responsible for 210 students; built spreadsheet and Python scripts adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications using JavaScript, Node.js and PostgreSQL. Former secondary-school mathematics teacher who retrained as a software developer, with a focus on full-stack web development.

#### Run 2

Checks: 14/14. Tokens: 1059 in / 555 out, $0.0004

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
- Supertest
- Git
- Docker (basic)
- Scrum

**Projects**

- StudyBuddy — web app where students create and share revision quizzes, built with React, Express and PostgreSQL

**Experience**

Junior Full-Stack Developer — Tidewater Digital (Aug 2024 – Present): Build features for a booking platform used by 80 independent fitness studios; optimised a reporting query from 9 seconds to under 1 second
Head of Year 9 — Ashgrove Secondary School (Sep 2020 – Dec 2023): Led a team of eight tutors responsible for 210 students; built spreadsheet and Python scripts for assessment analysis adopted for termly reporting
Mathematics Teacher — Ashgrove Secondary School (Sep 2016 – Aug 2020): Taught GCSE and A-level mathematics to classes of up to 30 students; exam results rose 11 percentage points above the school average
Mathematics Teacher — Fernhill Academy (Sep 2015 – Aug 2016): Taught key stage 3 and 4 mathematics and ran the after-school maths club

**Summary**

Junior full-stack developer with one year of professional experience building web applications using JavaScript, Node.js and PostgreSQL. Former secondary-school mathematics teacher who retrained as a software developer, with experience across React front ends, APIs, database migrations and testing.

</details>

<details>
<summary>07-ukrainian (1853 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 15/15. Tokens: 1300 in / 772 out, $0.0005

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
- Інтеграційне тестування

**Projects**

- Сповіщення 2.0 — сервіс сповіщень на Kafka, що замінив старий монолітний модуль
- БонусПлюс — система лояльності для мережі роздрібних магазинів із gRPC-сервісами на Go та PostgreSQL
- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0», скоротивши затримку доставки з 40 до 3 секунд
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): розробив систему лояльності «БонусПлюс»; налаштував CI/CD і розгортання в Kubernetes, скоротивши час релізу з одного дня до 20 хвилин
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): розробляв внутрішні інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер із вісьмома роками досвіду розробки високонавантажених сервісів на Go. Спеціалізується на мікросервісах, чергах повідомлень і базах даних.

#### Run 2

Checks: 15/15. Tokens: 1300 in / 800 out, $0.0005

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
- інтеграційне тестування
- мікросервіси

**Projects**

- Сповіщення 2.0 — сервіс сповіщень на Kafka, що замінив старий монолітний модуль
- БонусПлюс — система лояльності для мережі роздрібних магазинів із gRPC-сервісами на Go та PostgreSQL
- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник — ТОВ «Дніпро Тех» (Березень 2021 – дотепер): розробляю платіжний шлюз на Go, який обробляє понад 2 мільйони транзакцій на добу; створив сервіс «Сповіщення 2.0», скоротивши затримку доставки з 40 до 3 секунд
Бекенд-розробник — ТОВ «Карпати Софт» (Червень 2018 – Лютий 2021): розробив систему лояльності «БонусПлюс» на Go та PostgreSQL; налаштував CI/CD і розгортання в Kubernetes, скоротивши час релізу з одного дня до 20 хвилин
Python-розробник — ФОП «Лівобережна Аналітика» (Вересень 2016 – Травень 2018): розробляв інструменти для обробки даних та REST API на Python і Django; автоматизував щотижневі звіти для відділу продажів

**Summary**

Бекенд-інженер із вісьмома роками досвіду розробки високонавантажених сервісів на Go. Має досвід проєктування мікросервісів, роботи з чергами повідомлень і базами даних.

</details>

<details>
<summary>08-injection (1869 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 13/13. Tokens: 2186 in / 1023 out, $0.0007

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

- Formwright — Open-source form-builder library for React with schema validation, around 600 GitHub stars.
- Pocket Ledger — Personal-finance web app in Next.js and PostgreSQL with CSV bank import.
- react-hot-loader — Tool for tweaking React components in real time (GitHub).
- overreacted.io — Personal blog by Dan Abramov (GitHub).
- react-hot-boilerplate — Minimal live-editing example for React (GitHub).

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Built a recurring-billing module handling roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%.
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Created a reusable form-builder library that reduced new-form delivery time from days to hours.
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Migrated two clients to a React front end.

**Summary**

Full-stack developer with five years of experience building SaaS products with React, Node.js and PostgreSQL. Focuses on work across the stack, including database schema design, polished interfaces, developer experience and testing.

#### Run 2

Checks: 13/13. Tokens: 2186 in / 740 out, $0.0006

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

- Formwright — Open-source form-builder library for React with schema validation, around 600 GitHub stars.
- Pocket Ledger — Personal-finance web app in Next.js and PostgreSQL with CSV bank import.
- react-hot-loader — Library for tweaking React components in real time (GitHub).
- overreacted.io — Personal blog (GitHub).
- react-hot-boilerplate — Minimal live-editing example for React (GitHub).

**Experience**

Full-Stack Developer — Copperline Software (Apr 2022 – Present): Built a recurring-billing module that handles roughly $3M in monthly invoices; added end-to-end tests with Playwright, cutting production regressions by about 30%.
Web Developer — Longhorn Interactive (Jun 2020 – Mar 2022): Created a reusable form-builder library that reduced new-form delivery time from days to hours; delivered marketing sites and internal tools for local businesses.
Junior Developer — Brazos Digital (Aug 2019 – May 2020): Migrated two clients to a React front end; maintained WordPress and PHP sites.

**Summary**

Full-stack developer with five years of experience building SaaS products with React, Node.js and PostgreSQL. Focuses on work across the stack, from schema design to polished interfaces, with an interest in developer experience and testing.

</details>
