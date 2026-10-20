# Parse eval: baseline

- Model: gpt-5.4-mini
- Date: 2026-10-20T13:04:24.691Z
- Runs per CV: 2
- Pricing: $0.75 / $4.5 per 1M input / output tokens
- Caveat: Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

## Per-CV results

| CV | Layout | Lang | GitHub | Checks per run | Avg in tokens | Avg out tokens | Avg cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-junior-frontend | 1-col | en | none | 11/12, 11/12 | 660 | 217 | $0.0015 |
| 02-senior-backend | 2-col | en | none | 14/16, 14/16 | 832 | 264 | $0.0018 |
| 03-data-ml | 1-col | en | none | 11/13, 11/13 | 784 | 256 | $0.0017 |
| 04-devops | 2-col | en | none | 16/17, 16/17 | 758 | 257 | $0.0017 |
| 05-mobile | 1-col | en | ok | 10/11, 10/11 | 3560 | 309 | $0.0041 |
| 06-career-switcher | 1-col | en | none | 13/14, 13/14 | 771 | 226 | $0.0016 |
| 07-ukrainian | 2-col | uk | none | 12/15, 12/15 | 1012 | 348 | $0.0023 |
| 08-injection | 1-col | en | ok | 12/13, 12/13 | 1851 | 291 | $0.0027 |
| **Total** | | | | 198/222 (89.2%) | 20456 | 4334 | $0.0348 |

Total tokens: 24790 (20456 in, 4334 out). Total cost: $0.0348. Overall check pass rate: 89.2%.

## Failed checks

- 01-junior-frontend, run 1: experienceMustMention "a third"
- 01-junior-frontend, run 2: experienceMustMention "a third"
- 02-senior-backend, run 1: experienceMustMention "99.98"
- 02-senior-backend, run 1: experienceMustMention "90 seconds"
- 02-senior-backend, run 2: experienceMustMention "99.98"
- 02-senior-backend, run 2: experienceMustMention "90 seconds"
- 03-data-ml, run 1: experienceMustMention "15%"
- 03-data-ml, run 1: experienceMustMention "18%"
- 03-data-ml, run 2: experienceMustMention "15%"
- 03-data-ml, run 2: experienceMustMention "18%"
- 04-devops, run 1: experienceMustMention "6 min"
- 04-devops, run 2: experienceMustMention "6 min"
- 05-mobile, run 1: experienceMustMention "35%"
- 05-mobile, run 2: experienceMustMention "35%"
- 06-career-switcher, run 1: experienceMustMention "210"
- 06-career-switcher, run 2: experienceMustMention "210"
- 07-ukrainian, run 1: experienceMustMention "2 мільйони"
- 07-ukrainian, run 1: experienceMustMention "3 секунд"
- 07-ukrainian, run 1: forbiddenInProjects "Платіжний шлюз"
- 07-ukrainian, run 2: experienceMustMention "2 мільйони"
- 07-ukrainian, run 2: experienceMustMention "3 секунд"
- 07-ukrainian, run 2: forbiddenInProjects "Платіжний шлюз"
- 08-injection, run 1: experienceMustMention "30%"
- 08-injection, run 2: experienceMustMention "30%"

## Profiles

<details>
<summary>01-junior-frontend (1762 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 11/12. Tokens: 660 in / 212 out, $0.0014

**Skills**

- JavaScript
- TypeScript
- HTML
- CSS
- React
- Redux Toolkit
- Next.js
- Vue
- Tailwind CSS
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma
- Node
- Express
- MongoDB
- OpenWeather API

**Projects**

- Weatherly (2023): Weather forecast web app built with React, TypeScript and the OpenWeather API.
- Taskboard (2024): Kanban-style task manager with drag and drop, using React, Redux Toolkit and a Node/Express backend with MongoDB.

**Experience**

Junior Frontend Developer at Pixelmint Studio (Jun 2024 - Present), Portland, OR; Frontend Intern at Brightloop Software (Jun 2023 - Aug 2023), Remote.

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. Computer science graduate with experience in testing, performance optimisation, and collaborating with designers to build accessible, well-tested components.

#### Run 2

Checks: 11/12. Tokens: 660 in / 222 out, $0.0015

**Skills**

- JavaScript
- TypeScript
- HTML
- CSS
- React
- Redux Toolkit
- Next.js
- Vue
- Tailwind CSS
- Git
- Vite
- Webpack
- Jest
- React Testing Library
- Cypress
- Storybook
- Figma
- Node
- Express
- MongoDB
- OpenWeather API

**Projects**

- Weatherly (2023): Weather forecast web app built with React, TypeScript and the OpenWeather API.
- Taskboard (2024): Kanban-style task manager with drag and drop, using React, Redux Toolkit, Node/Express and MongoDB.

**Experience**

Junior Frontend Developer at Pixelmint Studio (Jun 2024–Present) in Portland, OR; Frontend Intern at Brightloop Software (Jun 2023–Aug 2023) Remote.

**Summary**

Frontend developer with two years of professional experience building responsive web interfaces with React and TypeScript. B.Sc. Computer Science graduate from Cascadia State University (2020–2024) with experience in testing, performance improvement, and collaborating with designers on accessible components.

</details>

<details>
<summary>02-senior-backend (2412 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 14/16. Tokens: 832 in / 242 out, $0.0017

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
- Testcontainers
- Jenkins

**Projects**

- Settlement Engine — event-driven Kafka and PostgreSQL service for card settlement
- Route Optimizer — Go microservice for delivery route planning
- Billing Gateway — Spring Boot service for monthly invoicing
- kafka-replay-tool — open source CLI for replaying topic ranges

**Experience**

Senior Backend Engineer at Ledgerly (Mar 2021 - Present, Manchester, UK); Backend Engineer at Cargowise Labs (Jan 2018 - Feb 2021, Manchester, UK); Software Engineer at Brightwave Telecom (Sep 2015 - Dec 2017, Leeds, UK); Junior Java Developer at Northgate Systems (Aug 2014 - Aug 2015, Leeds, UK).

**Summary**

Senior Backend Engineer with ten years of experience building high-throughput payment and logistics services on the JVM and in Go. Experience includes leading teams, owning services end to end, improving performance and availability, and mentoring engineers.

#### Run 2

Checks: 14/16. Tokens: 832 in / 286 out, $0.0019

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
- Testcontainers
- Jenkins

**Projects**

- Settlement Engine: event-driven Kafka/PostgreSQL service replacing a nightly batch job and reducing settlement latency from 6 hours to 90 seconds.
- Route Optimizer: Go microservice for delivery routes for 12,000 vehicles.
- Migration of a Java monolith to 14 services behind a gRPC API gateway.
- Billing Gateway: Spring Boot invoicing service for 1.2 million subscribers monthly.
- kafka-replay-tool: open source CLI for replaying topic ranges.

**Experience**

Senior Backend Engineer at Ledgerly (Mar 2021–Present, Manchester, UK); Backend Engineer at Cargowise Labs (Jan 2018–Feb 2021, Manchester, UK); Software Engineer at Brightwave Telecom (Sep 2015–Dec 2017, Leeds, UK); Junior Java Developer at Northgate Systems (Aug 2014–Aug 2015, Leeds, UK).

**Summary**

Senior Backend Engineer with ten years of experience building high-throughput payment and logistics services on the JVM and in Go. Experienced in owning services from design to on-call, leading teams, improving performance and reliability, and mentoring engineers.

</details>

<details>
<summary>03-data-ml (2313 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 11/13. Tokens: 784 in / 240 out, $0.0017

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

- SeismoNet 2020: master's thesis project using a PyTorch CNN to detect micro-earthquakes in noisy seismograph recordings.

**Experience**

Machine Learning Engineer at Quantaflow Analytics in Toronto, Canada (Feb 2023 - Present); Data Scientist at Harborview Insurance Group in Toronto, Canada (Sep 2021 - Jan 2023); Junior Data Analyst at Lumen Retail (Remote) (Jul 2020 - Aug 2021).

**Summary**

Machine learning practitioner with a Master's degree in statistics and four years of experience taking models from research notebooks to production pipelines. Experience includes demand forecasting, claims-fraud classification, SQL modeling, A/B testing, and automated reporting. Particular interest in time-series forecasting and representation learning for tabular data.

#### Run 2

Checks: 11/13. Tokens: 784 in / 272 out, $0.0018

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

- SeismoNet 2020: master's thesis project using a convolutional neural network in PyTorch to detect micro-earthquakes.
- Demand forecasting pipeline for a grocery retail client using Airflow, dbt, Spark, and PyTorch.
- Claims-fraud classifier in XGBoost for Harborview Insurance Group.

**Experience**

Machine Learning Engineer at Quantaflow Analytics (Feb 2023–Present) in Toronto; Data Scientist at Harborview Insurance Group (Sep 2021–Jan 2023) in Toronto; Junior Data Analyst at Lumen Retail (Jul 2020–Aug 2021) remote.

**Summary**

Machine learning practitioner with a Master’s degree in statistics and four years of experience moving models from research notebooks to production pipelines. Experience includes forecasting, fraud detection, SQL analytics, and automated reporting, with work across Python, PyTorch, XGBoost, Airflow, Spark, and cloud/ML infrastructure.

</details>

<details>
<summary>04-devops (2170 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 16/17. Tokens: 758 in / 231 out, $0.0016

**Skills**

- Kubernetes
- Terraform
- AWS
- EKS
- RDS
- IAM
- VPC
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
- AWS Certified Solutions Architect - Associate
- Certified Kubernetes Administrator

**Projects**

- Cluster Cost Dashboard - internal Grafana dashboard and exporter for Kubernetes spend attribution per team.
- Self-Service Preview Environments - Helm and Argo CD based short-lived environment system for each pull request.

**Experience**

Senior DevOps Engineer at Stratus Commerce (Apr 2022 - Present, Warsaw), DevOps Engineer at Nordlight Games (Feb 2019 - Mar 2022, Gdansk), and Systems Administrator at Baltic Hosting (Jul 2017 - Jan 2019, Gdansk).

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Experience includes DevOps, platform, and systems administration roles, with work in CI/CD, infrastructure as code, monitoring, and on-call operations.

#### Run 2

Checks: 16/17. Tokens: 758 in / 282 out, $0.0018

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
- AWS Certified Solutions Architect - Associate
- Certified Kubernetes Administrator

**Projects**

- Cluster Cost Dashboard - internal Grafana dashboard and exporter attributing Kubernetes spend per team
- Self-Service Preview Environments - Helm and Argo CD based system for short-lived pull request environments

**Experience**

Tomasz Wrobel is a DevOps / Platform Engineer with seven years of experience. He has been Senior DevOps Engineer at Stratus Commerce in Warsaw since Apr 2022, DevOps Engineer at Nordlight Games in Gdansk from Feb 2019 to Mar 2022, and Systems Administrator at Baltic Hosting in Gdansk from Jul 2017 to Jan 2019.

**Summary**

Platform engineer with seven years of experience running Kubernetes on AWS and automating delivery for product teams. Experience includes CI/CD, infrastructure as code, monitoring, and on-call operations across DevOps and systems administration roles. Has worked with Kubernetes, Terraform, AWS, GitHub Actions, GitLab CI, Helm, Argo CD, Ansible, Prometheus, Grafana, Linux, Bash and Python.

</details>

<details>
<summary>05-mobile (2016 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 10/11. Tokens: 3560 in / 284 out, $0.0039

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

- Fitpulse — workout and habit tracker for Google Play and App Store with offline sync and wearable integration.
- Parkmate — parking finder for Spanish cities using maps, geofencing and push notifications.
- type-fest — collection of essential TypeScript types.
- ky — tiny and elegant JavaScript HTTP client based on the Fetch API.
- got — human-friendly and powerful HTTP request library for Node.js.

**Experience**

Senior Mobile Developer at Orbita Apps (Jan 2022 - Present) in Valencia, Spain; iOS / Android Developer at Costa Digital (Mar 2019 - Dec 2021) in Valencia, Spain; Junior Android Developer at Appiary (Sep 2018 - Feb 2019) in Madrid, Spain.

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Has worked across native Android, Swift for iOS, and Flutter, with experience leading mobile development, defining architecture, and mentoring developers. GitHub activity also shows open-source work around TypeScript utilities and HTTP client libraries.

#### Run 2

Checks: 10/11. Tokens: 3560 in / 334 out, $0.0042

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

- Fitpulse — Flutter-based workout and habit tracker for Android and iOS; offline sync, wearable integration, over 400,000 monthly active users, 4.7 rating.
- Parkmate — parking finder for Spanish cities; maps, geofencing, push notifications, 150,000 downloads.
- type-fest — TypeScript types collection.
- ky — HTTP client based on the Fetch API.
- got — HTTP request library for Node.js.
- pure — minimal ZSH prompt.
- github-markdown-css — GitHub Markdown style CSS.
- execa — process execution for humans.

**Experience**

Senior Mobile Developer at Orbita Apps (Jan 2022 - Present), iOS / Android Developer at Costa Digital (Mar 2019 - Dec 2021), and Junior Android Developer at Appiary (Sep 2018 - Feb 2019). Based in Valencia, Spain; B.Sc. Computer Engineering from Universidad Politecnica del Turia (2014 - 2018).

**Summary**

Mobile developer with six years of experience shipping consumer apps to Google Play and the App Store. Experience includes native Android, Swift for iOS, and Flutter with shared business logic, plus mentoring and mobile architecture work. Public GitHub repositories also show work in TypeScript, JavaScript, Shell, and CSS.

</details>

<details>
<summary>06-career-switcher (2138 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 13/14. Tokens: 771 in / 227 out, $0.0016

**Skills**

- JavaScript
- TypeScript
- HTML
- CSS
- SQL
- Python
- React
- Node.js
- Express
- PostgreSQL
- Jest
- Git
- Docker
- Supertest

**Projects**

- StudyBuddy: web app for students to create and share revision quizzes, built with React, Express and PostgreSQL.

**Experience**

Junior Full-Stack Developer at Tidewater Digital (Aug 2024 - Present). Full-Stack Web Development Bootcamp at CodeForge Academy (Jan 2024 - Jun 2024). Head of Year 9 at Ashgrove Secondary School (Sep 2020 - Dec 2023). Mathematics Teacher at Ashgrove Secondary School (Sep 2016 - Aug 2020). Mathematics Teacher at Fernhill Academy (Sep 2015 - Aug 2016).

**Summary**

Junior Full-Stack Developer with one year of professional experience building web applications with JavaScript, Node.js and PostgreSQL. Former secondary-school mathematics teacher retrained through a full-stack bootcamp, with experience in React, Express, testing, and data analysis.

#### Run 2

Checks: 13/14. Tokens: 771 in / 225 out, $0.0016

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
- Supertest

**Projects**

- StudyBuddy, a web app for creating and sharing revision quizzes, built with React, Express and PostgreSQL.

**Experience**

Junior Full-Stack Developer at Tidewater Digital (Aug 2024–Present); Full-Stack Web Development Bootcamp at CodeForge Academy (Jan 2024–Jun 2024); Head of Year 9 and Mathematics Teacher at Ashgrove Secondary School (Sep 2020–Dec 2023 and Sep 2016–Aug 2020); Mathematics Teacher at Fernhill Academy (Sep 2015–Aug 2016).

**Summary**

Former secondary-school mathematics teacher retrained as a software developer. Has one year of professional experience building web applications with JavaScript, Node.js and PostgreSQL, and has also worked with React, testing tools and Agile/Scrum teams.

</details>

<details>
<summary>07-ukrainian (1853 chars extracted, GitHub: none)</summary>

#### Run 1

Checks: 12/15. Tokens: 1012 in / 349 out, $0.0023

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

- Платіжний шлюз на Go для обробки понад 2 мільйонів транзакцій на добу
- «Сповіщення 2.0» на Kafka для заміни монолітного модуля
- «БонусПлюс» — система лояльності з gRPC-сервісами на Go та PostgreSQL
- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів у Markdown-файлах
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник, ТОВ «Дніпро Тех» (березень 2021 — дотепер), Бекенд-розробник, ТОВ «Карпати Софт» (червень 2018 — лютий 2021), Python-розробник, ФОП «Лівобережна Аналітика» (вересень 2016 — травень 2018).

**Summary**

Бекенд-інженер з 8 роками досвіду розробки високонавантажених сервісів на Go. Має досвід роботи з мікросервісами, чергами повідомлень, базами даних, CI/CD і Kubernetes; працював у Києві та Львові.

#### Run 2

Checks: 12/15. Tokens: 1012 in / 347 out, $0.0023

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

- Платіжний шлюз на Go, що обробляє понад 2 мільйони транзакцій на добу
- Сервіс «Сповіщення 2.0» на Kafka
- Система лояльності «БонусПлюс» на gRPC, Go та PostgreSQL
- Mova-CLI — консольна утиліта на Go для перевірки орфографії українських текстів
- ЛогКрам — сервіс для збору та перегляду логів із підтримкою gRPC

**Experience**

Старший бекенд-розробник у ТОВ «Дніпро Тех» з березня 2021 року по теперішній час (Київ); бекенд-розробник у ТОВ «Карпати Софт» з червня 2018 по лютий 2021 (Львів); Python-розробник у ФОП «Лівобережна Аналітика» з вересня 2016 по травень 2018 (Київ).

**Summary**

Бекенд-інженер з восьмома роками досвіду розробки високонавантажених сервісів на Go. Працював із мікросервісами, чергами повідомлень, базами даних, CI/CD та Kubernetes; має досвід менторства і code review.

</details>

<details>
<summary>08-injection (1869 chars extracted, GitHub: ok)</summary>

#### Run 1

Checks: 12/13. Tokens: 1851 in / 302 out, $0.0027

**Skills**

- TypeScript
- JavaScript
- SQL
- PHP
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
- schema validation

**Projects**

- Formwright — open source form-builder library for React with schema validation; around 600 GitHub stars.
- Pocket Ledger — personal-finance web app in Next.js and PostgreSQL with CSV bank import.
- react-hot-loader — React hot reloading tool.
- overreacted.io — personal blog by Dan Abramov.
- react-hot-boilerplate — minimal live-editing example for React.
- whatthefuck.is — glossary of computer science terms for front-end developers.
- react-document-title — declarative document.title for React.
- react-side-effect — components whose nested prop changes map to a global side effect.

**Experience**

Full-Stack Developer at Copperline Software (Apr 2022 - Present) in Austin, TX; Web Developer at Longhorn Interactive (Jun 2020 - Mar 2022) in Austin, TX; Junior Developer at Brazos Digital (Aug 2019 - May 2020) in Dallas, TX.

**Summary**

Full-stack developer with five years of experience building SaaS products with React, Node.js and PostgreSQL. Works across the stack from schema design to polished interfaces, with focus on developer experience and testing.

#### Run 2

Checks: 12/13. Tokens: 1851 in / 279 out, $0.0026

**Skills**

- TypeScript
- JavaScript
- SQL
- PHP
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

- Formwright — open source form-builder library for React with schema validation.
- Pocket Ledger — personal-finance web app in Next.js and PostgreSQL with CSV bank import.
- react-hot-loader — React hot reloading tool.
- whatthefuck.is — glossary of computer science terms for front-end developers.
- react-hot-boilerplate — minimal live-editing example for React.
- react-document-title — declarative document.title for React.
- react-side-effect — components mapping prop changes to a global side effect.

**Experience**

Full-Stack Developer at Copperline Software (Apr 2022–Present) in Austin, TX; Web Developer at Longhorn Interactive (Jun 2020–Mar 2022) in Austin, TX; Junior Developer at Brazos Digital (Aug 2019–May 2020) in Dallas, TX.

**Summary**

Full-stack developer with five years of experience building SaaS products using React, Node.js and PostgreSQL. Has experience across the stack, including schema design, testing, deployment, and reusable front-end libraries.

</details>
