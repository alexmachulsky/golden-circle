# AWS EKS Production Deployment PRD

**Status:** Drafted  
**Date:** 2026-04-13  
**Repo:** `golden-circle`

## Summary

Golden Circle already builds as a standalone Next.js container and can run locally with Docker. The missing piece is a production-grade AWS deployment foundation with reproducible infrastructure, a secure secret path for `GROQ_API_KEY`, a public HTTPS endpoint, and a repeatable release process.

This PRD defines the first production deployment design for the existing Groq-backed application. The chosen direction is a dedicated Amazon EKS cluster in AWS Mumbai (`ap-south-1`), provisioned with Terraform, fronted by an AWS Application Load Balancer, and released through Helm from GitHub Actions using AWS OIDC.

## Problem Statement

The current repository can build and package the application, but it cannot yet:

- provision AWS infrastructure from source control
- host the application behind a production custom domain and TLS certificate
- store and inject runtime secrets using AWS-native services
- separate infrastructure changes from application releases
- deploy safely through GitHub Actions without long-lived AWS credentials

Without these capabilities, production deployment is manual, error-prone, and hard to audit or reproduce.

## Goals

- Provision production AWS infrastructure from Terraform.
- Use a remote Terraform backend in AWS rather than local state.
- Run the application on a dedicated EKS cluster in `ap-south-1`.
- Publish container images to Amazon ECR.
- Expose the app on a custom Route 53 domain with ACM-backed TLS.
- Keep `GROQ_API_KEY` in AWS Secrets Manager and inject it into the running pod without committing it to Git.
- Release the application through Helm from GitHub Actions using GitHub OIDC and least-privilege IAM roles.
- Add a lightweight app health endpoint suitable for ALB and Kubernetes probes.

## Non-Goals

- Migrating from Groq to Anthropic Claude or Amazon Bedrock
- Creating staging or development AWS environments
- Introducing Argo CD or a full GitOps control plane
- Adding CloudFront, WAF, or a service mesh in the first iteration
- Re-platforming the app to ECS, App Runner, or Lambda

## Current State

- The app is a Next.js 16 App Router application.
- `next.config.ts` already uses `output: "standalone"`.
- `Dockerfile` already builds a minimal runtime image and runs as a non-root user.
- `docker-compose.yml` already runs the container locally with `.env.local`.
- The only required runtime secret is `GROQ_API_KEY`.
- The application does not yet expose a dedicated health-check endpoint.
- The repository has CI for build, test, lint, type-check, container packaging, and GHCR publishing, but no AWS deployment workflow.

## Chosen Architecture

### Why EKS

EKS is heavier than this application strictly needs, but it is the explicit deployment target selected for the project. Because of that, the first design keeps the platform intentionally lean and avoids platform extras that do not directly improve first-production readiness.

### High-Level Design

- Terraform `bootstrap` root creates the AWS S3 backend used for Terraform remote state.
- Terraform `prod` root provisions the AWS production footprint:
  - VPC across two Availability Zones in `ap-south-1`
  - public subnets for the ALB
  - private subnets for EKS worker nodes
  - one dedicated EKS cluster
  - one managed node group using on-demand AL2023 nodes
  - one ECR repository for the app image
  - one Route 53 hosted zone and ACM certificate
  - one Secrets Manager secret containing the Groq API key payload
  - IAM roles for GitHub OIDC and in-cluster workloads
- Terraform also installs the minimum required EKS add-ons and controllers:
  - AWS Load Balancer Controller
  - `external-dns`
  - Secrets Store CSI Driver and AWS provider
- The application is deployed with a Helm chart stored in this repository.
- GitHub Actions builds the image, pushes it to ECR, updates the kubeconfig, and runs `helm upgrade --install` on `main`.

## Alternatives Considered

### App Runner

App Runner would be operationally simpler for a single Next.js container, but it does not match the explicit EKS requirement and would not give the same Terraform and Kubernetes operating model.

### ECS Fargate

ECS Fargate is arguably a better fit than EKS for a small app like this. It would reduce cluster operations burden. It was not chosen because the deployment target was explicitly set to EKS.

### Full GitOps with Argo CD

Argo CD is a strong long-term pattern, but it would add a second control plane and more bootstrap complexity than this repo currently needs. The first release should keep infrastructure and application delivery understandable to a small team.

## Detailed Requirements

### Infrastructure and State

- Terraform state must live in AWS, not on a developer workstation.
- The backend must use S3 with versioning, encryption, and public-access blocking.
- The production stack must live in a separate Terraform root from the backend bootstrap.
- The production stack must be safe to plan in pull requests and safe to apply only after explicit approval.

### Networking

- Use `ap-south-1` as the default AWS region.
- Use two Availability Zones for cluster and ALB resilience.
- Place internet-facing load balancers in public subnets.
- Place worker nodes in private subnets.
- Use a custom hostname with HTTPS only.

### Kubernetes Platform

- Use one dedicated production EKS cluster.
- Use one managed node group with on-demand instances as the initial default.
- Keep cluster add-ons minimal and focused on ingress, DNS, and secrets.
- Use immutable image tags derived from the Git commit SHA.

### Secret Management

- Store the Groq key in AWS Secrets Manager as a JSON object:

```json
{
  "GROQ_API_KEY": "actual-key-value"
}
```

- Make the secret available to the app through the Secrets Store CSI Driver plus a synced Kubernetes Secret.
- Avoid storing the Groq key in GitHub Actions secrets if AWS can source it at runtime instead.

### DNS and TLS

- Manage the public hosted zone and ACM certificate in Terraform.
- Use Route 53 DNS validation for the ACM certificate.
- Let the application hostname be managed dynamically by `external-dns` from the Kubernetes ingress, while Terraform remains the owner of the hosted zone itself.

### Application Release Flow

- Keep infrastructure changes separate from application releases.
- Continue to run app CI on pull requests and pushes.
- Add one workflow for Terraform plan on pull requests.
- Add one protected workflow for Terraform apply after review.
- Add one production deployment workflow that runs on merges to `main`, uses GitHub OIDC to assume an AWS role, pushes the image to ECR, and upgrades the Helm release.

### Application Changes

- Add `GET /api/health` returning a lightweight success payload and status code `200`.
- Use the new endpoint for both Kubernetes probes and the ALB target health check.
- Do not change the app's public behavior or the `POST /api/analyze` API contract.

## Security Requirements

- Use least-privilege IAM roles for:
  - Terraform plan/apply
  - GitHub app deployment
  - AWS Load Balancer Controller
  - `external-dns`
  - application access to Secrets Manager through the CSI integration
- Do not use long-lived AWS access keys in GitHub.
- Do not store the Groq key in Terraform variables or commit it into Helm values.
- Keep ECR tag immutability enabled for commit SHA tags.

## Observability and Operations

- Enable EKS control plane logging.
- Add Kubernetes readiness and liveness probes against `/api/health`.
- Make the deployment easy to verify using a public HTTPS endpoint and a real streaming request.
- Treat centralized application log shipping as a later phase if it materially complicates v1.

## Acceptance Criteria

- Terraform can bootstrap a remote state bucket in AWS and then plan the production stack from a separate root.
- Terraform can provision the production VPC, EKS cluster, ECR repository, hosted zone, ACM certificate, and required IAM roles.
- The app can be deployed to EKS through Helm using an image stored in ECR.
- The public hostname resolves and serves valid HTTPS.
- The ALB and Kubernetes probes report the app healthy through `GET /api/health`.
- A real `POST /api/analyze` request succeeds through the public production hostname and streams a response.
- The running pod receives `GROQ_API_KEY` from AWS Secrets Manager without the key appearing in Git, Terraform state, or committed Helm values.
- GitHub Actions can deploy without static AWS credentials by using OIDC role assumption.

## Risks and Mitigations

### EKS is operationally heavy for a single small app

Mitigation: keep the cluster dedicated, keep the add-on set small, avoid GitOps and service mesh in v1, and prefer managed AWS components where possible.

### DNS ownership split between Terraform and `external-dns`

Mitigation: Terraform owns the hosted zone and certificate; `external-dns` owns only the application record within that zone.

### Secrets synchronization can fail if the CSI stack or IAM role is misconfigured

Mitigation: verify the secret end to end before cutover by checking the synced Kubernetes Secret and performing a real app request in-cluster and through the ALB.

### Production infra drift

Mitigation: require Terraform plans on PRs, keep manual approval on apply, and avoid manual AWS console edits except for break-glass recovery.

## Rollout Plan

1. Add the app health endpoint and keep the current local workflow working.
2. Add Terraform backend bootstrap.
3. Add the production Terraform root and modules.
4. Add EKS add-ons and IAM roles.
5. Add the Helm chart and deploy the app manually once.
6. Add GitHub Actions OIDC workflows for repeatable plan, apply, and deploy.
7. Cut over the custom hostname to the production ALB-managed ingress.

## Decision Log

- "AWS Claude" is interpreted here as AWS hosting only, not a model-provider migration.
- Region default is AWS Mumbai, `ap-south-1`.
- Environment count is production only.
- Runtime is a dedicated EKS cluster, not a shared cluster.
- Delivery model is Terraform for infrastructure and Helm for the application.
- Terraform apply requires manual approval.

## References

- Terraform S3 backend: https://developer.hashicorp.com/terraform/language/settings/backends/s3
- GitHub Actions OIDC for AWS: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws?apiVersion=2022-11-28
- EKS Kubernetes version lifecycle: https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html
- EKS access entries: https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html
- AWS Load Balancer Controller on EKS: https://docs.aws.amazon.com/eks/latest/userguide/lbc-helm.html
- EKS secrets integration: https://docs.aws.amazon.com/eks/latest/userguide/manage-secrets.html
