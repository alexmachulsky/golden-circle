# AWS EKS Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Groq-backed Next.js application to a dedicated production EKS environment in `ap-south-1`, with Terraform-managed AWS infrastructure, Helm-based application delivery, a Route 53–managed HTTP-only ALB ingress, and GitHub Actions OIDC automation.

**Architecture:** Use a two-root Terraform layout. `infra/bootstrap` creates the AWS S3 remote-state bucket, and `infra/environments/prod` provisions the production VPC, ECR repository, EKS cluster, Route 53 hosted zone, IAM roles, and supporting add-ons. Deploy the app through a repo-local Helm chart that reads `GROQ_API_KEY` from AWS Secrets Manager via the Secrets Store CSI Driver and exposes the app through the AWS Load Balancer Controller. The ALB listens on HTTP:80 only — no ACM certificate, no TLS termination at the edge.

**Tech Stack:** Terraform, AWS S3, VPC, IAM, ECR, EKS, Route 53, Secrets Manager, Helm, Kubernetes, GitHub Actions OIDC, Docker, Next.js 16, TypeScript

---

## Planned File Structure

**Infrastructure roots**

- Create: `infra/bootstrap/versions.tf`
- Create: `infra/bootstrap/providers.tf`
- Create: `infra/bootstrap/variables.tf`
- Create: `infra/bootstrap/main.tf`
- Create: `infra/bootstrap/outputs.tf`
- Create: `infra/bootstrap/terraform.tfvars.example`
- Create: `infra/environments/prod/versions.tf`
- Create: `infra/environments/prod/providers.tf`
- Create: `infra/environments/prod/backend.hcl.example`
- Create: `infra/environments/prod/variables.tf`
- Create: `infra/environments/prod/main.tf`
- Create: `infra/environments/prod/outputs.tf`
- Create: `infra/environments/prod/terraform.tfvars.example`

**Infrastructure modules**

- Create: `infra/modules/network/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/ecr/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/eks/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/dns/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/github_oidc_roles/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/irsa_role/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/secrets/{main.tf,variables.tf,outputs.tf}`

**Application deployment**

- Create: `deploy/helm/golden-circle/Chart.yaml`
- Create: `deploy/helm/golden-circle/values.yaml`
- Create: `deploy/helm/golden-circle/templates/_helpers.tpl`
- Create: `deploy/helm/golden-circle/templates/serviceaccount.yaml`
- Create: `deploy/helm/golden-circle/templates/secretproviderclass.yaml`
- Create: `deploy/helm/golden-circle/templates/deployment.yaml`
- Create: `deploy/helm/golden-circle/templates/service.yaml`
- Create: `deploy/helm/golden-circle/templates/ingress.yaml`

**Application code and docs**

- Create: `app/api/health/route.ts`
- Create: `app/api/health/route.test.ts`
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `.github/workflows/terraform-plan.yml`
- Create: `.github/workflows/terraform-apply.yml`
- Create: `.github/workflows/deploy-production.yml`

### Task 1: Add an explicit health endpoint for Kubernetes and ALB

**Files:**

- Create: `app/api/health/route.ts`
- Create: `app/api/health/route.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns a 200 readiness payload", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails because the route does not exist yet**

Run: `npm test -- app/api/health/route.test.ts`  
Expected: FAIL with a module resolution error for `@/app/api/health/route`

- [ ] **Step 3: Implement the health route**

```ts
export async function GET() {
  return Response.json({ status: "ok" });
}
```

- [ ] **Step 4: Document the new health-check contract in the README deployment section**

```md
## Production health checks

- `GET /api/health` returns `200` with `{ "status": "ok" }`
- Kubernetes readiness and liveness probes must target this endpoint
- The ALB target group's health check must also target this endpoint
```

- [ ] **Step 5: Re-run the local verification commands**

Run: `npm test -- app/api/health/route.test.ts && npm run lint && npx tsc --noEmit && npm run build`  
Expected: all commands pass

- [ ] **Step 6: Commit**

```bash
git add app/api/health/route.ts app/api/health/route.test.ts README.md
git commit -m "feat: add production health endpoint"
```

### Task 2: Bootstrap the Terraform remote state backend

**Files:**

- Modify: `.gitignore`
- Create: `infra/bootstrap/versions.tf`
- Create: `infra/bootstrap/providers.tf`
- Create: `infra/bootstrap/variables.tf`
- Create: `infra/bootstrap/main.tf`
- Create: `infra/bootstrap/outputs.tf`
- Create: `infra/bootstrap/terraform.tfvars.example`

- [ ] **Step 1: Add Terraform local-artifact ignore rules without ignoring the provider lock file**

```gitignore
# terraform
.terraform/
*.tfstate
*.tfstate.*
crash.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
```

- [ ] **Step 2: Create the bootstrap Terraform version and provider definitions**

```hcl
terraform {
  required_version = "~> 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

```hcl
provider "aws" {
  region = var.aws_region
}
```

- [ ] **Step 3: Create the bootstrap resources for the remote state bucket**

```hcl
resource "aws_s3_bucket" "terraform_state" {
  bucket = var.state_bucket_name
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

- [ ] **Step 4: Add variables, outputs, and an example tfvars file**

```hcl
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "state_bucket_name" {
  type = string
}
```

```hcl
output "state_bucket_name" {
  value = aws_s3_bucket.terraform_state.bucket
}
```

```hcl
aws_region        = "ap-south-1"
state_bucket_name = "golden-circle-terraform-state-prod"
```

- [ ] **Step 5: Initialize and apply the bootstrap root using local state**

Run: `cd infra/bootstrap && cp terraform.tfvars.example terraform.tfvars && terraform init && terraform validate && terraform apply -var-file=terraform.tfvars`  
Expected: the S3 bucket is created and `terraform output state_bucket_name` returns the configured bucket name

- [ ] **Step 6: Commit**

```bash
git add .gitignore infra/bootstrap
git commit -m "feat: bootstrap terraform remote state"
```

### Task 3: Build the production Terraform root and core AWS modules

**Files:**

- Create: `infra/environments/prod/versions.tf`
- Create: `infra/environments/prod/providers.tf`
- Create: `infra/environments/prod/backend.hcl.example`
- Create: `infra/environments/prod/variables.tf`
- Create: `infra/environments/prod/main.tf`
- Create: `infra/environments/prod/outputs.tf`
- Create: `infra/environments/prod/terraform.tfvars.example`
- Create: `infra/modules/network/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/ecr/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/eks/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/dns/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/github_oidc_roles/{main.tf,variables.tf,outputs.tf}`
- Create: `infra/modules/secrets/{main.tf,variables.tf,outputs.tf}`

- [ ] **Step 1: Create the production Terraform root and remote backend configuration**

```hcl
terraform {
  required_version = "~> 1.11.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }

    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38"
    }
  }
}
```

```hcl
bucket       = "golden-circle-terraform-state-prod"
key          = "golden-circle/prod/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true
```

- [ ] **Step 2: Wire the root module to the core production modules**

```hcl
module "network" {
  source               = "../../modules/network"
  name                 = "golden-circle-prod"
  aws_region           = var.aws_region
  availability_zones   = ["ap-south-1a", "ap-south-1b"]
  vpc_cidr             = "10.24.0.0/16"
  public_subnet_cidrs  = ["10.24.0.0/20", "10.24.16.0/20"]
  private_subnet_cidrs = ["10.24.128.0/20", "10.24.144.0/20"]
}

module "ecr" {
  source          = "../../modules/ecr"
  repository_name = "golden-circle"
}

module "dns" {
  source      = "../../modules/dns"
  root_domain = var.root_domain
  app_fqdn    = "${var.app_subdomain}.${var.root_domain}"
  create_zone = true
}

module "secrets" {
  source           = "../../modules/secrets"
  secret_name      = "golden-circle/prod/runtime"
  secret_json_keys = ["GROQ_API_KEY"]
}

module "eks" {
  source              = "../../modules/eks"
  cluster_name        = "golden-circle-prod"
  kubernetes_version  = "1.35"
  vpc_id              = module.network.vpc_id
  private_subnet_ids  = module.network.private_subnet_ids
  public_subnet_ids   = module.network.public_subnet_ids
  enable_public_api   = true
  node_group_desired  = 2
  node_group_min      = 2
  node_group_max      = 4
  node_instance_types = ["t3.large"]
}

module "github_oidc_roles" {
  source                 = "../../modules/github_oidc_roles"
  github_repository      = "alexmachulsky/golden-circle"
  terraform_role_name    = "golden-circle-terraform-prod"
  deploy_role_name       = "golden-circle-deploy-prod"
  aws_region             = var.aws_region
  ecr_repository_arn     = module.ecr.repository_arn
  eks_cluster_name       = module.eks.cluster_name
}
```

- [ ] **Step 3: Implement the module responsibilities cleanly**

```hcl
# network
# - VPC, subnets, internet gateway, route tables, NAT gateways
# ecr
# - repository, scan-on-push, lifecycle policy
# dns
# - public hosted zone only (no ACM certificate, no validation records)
# - external-dns creates the app A/AAAA record at runtime
# secrets
# - Secrets Manager secret container only, not the live value
# eks
# - cluster, managed node group, cluster security groups, access entries, control plane logs
# github_oidc_roles
# - IAM OIDC provider, one Terraform role, one deploy role
```

- [ ] **Step 4: Add the production input and output contracts**

```hcl
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "root_domain" {
  type = string
}

variable "app_subdomain" {
  type    = string
  default = "golden-circle"
}
```

```hcl
aws_region    = "ap-south-1"
root_domain   = "example.com"
app_subdomain = "golden-circle"
```

```hcl
output "cluster_name" {
  value = module.eks.cluster_name
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "application_fqdn" {
  value = "${var.app_subdomain}.${var.root_domain}"
}

output "application_url" {
  value = "http://${var.app_subdomain}.${var.root_domain}"
}
```

- [ ] **Step 5: Validate the production root without applying it yet**

Run: `cd infra/environments/prod && cp terraform.tfvars.example terraform.tfvars && terraform init -backend-config=backend.hcl.example && terraform fmt -check -recursive && terraform validate && terraform plan -var-file=terraform.tfvars`  
Expected: `terraform validate` succeeds and `terraform plan` shows only the expected production resources

- [ ] **Step 6: Commit**

```bash
git add infra/environments/prod infra/modules
git commit -m "feat: add production terraform stack"
```

### Task 4: Install EKS add-ons and workload IAM roles for ingress, DNS, and secrets

**Files:**

- Create: `infra/modules/irsa_role/{main.tf,variables.tf,outputs.tf}`
- Modify: `infra/environments/prod/main.tf`
- Modify: `infra/environments/prod/outputs.tf`

- [ ] **Step 1: Create a reusable IRSA role module for Kubernetes service accounts**

```hcl
variable "role_name" {
  type = string
}

variable "oidc_provider_arn" {
  type = string
}

variable "oidc_provider_url" {
  type = string
}

variable "namespace" {
  type = string
}

variable "service_account_name" {
  type = string
}

variable "policy_json" {
  type = string
}
```

```hcl
data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(var.oidc_provider_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account_name}"]
    }
  }
}
```

- [ ] **Step 2: Add IRSA roles for AWS Load Balancer Controller, `external-dns`, and the application**

```hcl
module "alb_controller_irsa" {
  source               = "../../modules/irsa_role"
  role_name            = "golden-circle-alb-controller"
  oidc_provider_arn    = module.eks.oidc_provider_arn
  oidc_provider_url    = module.eks.oidc_provider_url
  namespace            = "kube-system"
  service_account_name = "aws-load-balancer-controller"
  policy_json          = data.aws_iam_policy_document.alb_controller.json
}

module "external_dns_irsa" {
  source               = "../../modules/irsa_role"
  role_name            = "golden-circle-external-dns"
  oidc_provider_arn    = module.eks.oidc_provider_arn
  oidc_provider_url    = module.eks.oidc_provider_url
  namespace            = "kube-system"
  service_account_name = "external-dns"
  policy_json          = data.aws_iam_policy_document.external_dns.json
}

module "app_irsa" {
  source               = "../../modules/irsa_role"
  role_name            = "golden-circle-app-runtime"
  oidc_provider_arn    = module.eks.oidc_provider_arn
  oidc_provider_url    = module.eks.oidc_provider_url
  namespace            = "golden-circle"
  service_account_name = "golden-circle"
  policy_json          = data.aws_iam_policy_document.app_runtime.json
}
```

- [ ] **Step 3: Install the cluster add-ons with Terraform-managed Helm releases**

```hcl
resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.alb_controller_irsa.role_arn
  }
}
```

```hcl
resource "helm_release" "external_dns" {
  name       = "external-dns"
  repository = "https://kubernetes-sigs.github.io/external-dns"
  chart      = "external-dns"
  namespace  = "kube-system"

  values = [yamlencode({
    provider = "aws"
    domainFilters = [var.root_domain]
    txtOwnerId = module.eks.cluster_name
    serviceAccount = {
      create = true
      name   = "external-dns"
      annotations = {
        "eks.amazonaws.com/role-arn" = module.external_dns_irsa.role_arn
      }
    }
  })]
}
```

```hcl
resource "helm_release" "secrets_store_csi_driver" {
  name       = "secrets-store-csi-driver"
  repository = "https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts"
  chart      = "secrets-store-csi-driver"
  namespace  = "kube-system"

  values = [yamlencode({
    syncSecret = {
      enabled = true
    }
    enableSecretRotation = true
  })]
}
```

```hcl
resource "helm_release" "secrets_store_csi_driver_provider_aws" {
  name       = "secrets-provider-aws"
  repository = "https://aws.github.io/secrets-store-csi-driver-provider-aws"
  chart      = "secrets-store-csi-driver-provider-aws"
  namespace  = "kube-system"
}
```

- [ ] **Step 4: Validate Terraform again after the add-on layer is present**

Run: `cd infra/environments/prod && terraform fmt -check -recursive && terraform validate && terraform plan -var-file=terraform.tfvars`  
Expected: the plan now includes the add-on releases, IRSA roles, and no unexpected destroy actions

- [ ] **Step 5: Commit**

```bash
git add infra/modules/irsa_role infra/environments/prod
git commit -m "feat: add eks controllers and workload iam roles"
```

### Task 5: Package the application as a Helm chart and wire in AWS Secrets Manager

**Files:**

- Create: `deploy/helm/golden-circle/Chart.yaml`
- Create: `deploy/helm/golden-circle/values.yaml`
- Create: `deploy/helm/golden-circle/templates/_helpers.tpl`
- Create: `deploy/helm/golden-circle/templates/serviceaccount.yaml`
- Create: `deploy/helm/golden-circle/templates/secretproviderclass.yaml`
- Create: `deploy/helm/golden-circle/templates/deployment.yaml`
- Create: `deploy/helm/golden-circle/templates/service.yaml`
- Create: `deploy/helm/golden-circle/templates/ingress.yaml`

- [ ] **Step 1: Create the chart metadata and default values**

```yaml
apiVersion: v2
name: golden-circle
description: Production Helm chart for the Golden Circle Next.js app
type: application
version: 0.1.0
appVersion: "0.1.0"
```

```yaml
image:
  repository: ""
  tag: ""
  pullPolicy: IfNotPresent

serviceAccount:
  create: true
  name: "golden-circle"
  roleArn: ""

secrets:
  managerSecretId: "golden-circle/prod/runtime"
  kubernetesSecretName: "golden-circle-runtime"

ingress:
  enabled: true
  host: ""

resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "500m"
    memory: "1Gi"
```

- [ ] **Step 2: Add the ServiceAccount and SecretProviderClass templates**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Values.serviceAccount.name }}
  annotations:
    eks.amazonaws.com/role-arn: {{ .Values.serviceAccount.roleArn | quote }}
```

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: {{ include "golden-circle.fullname" . }}
spec:
  provider: aws
  secretObjects:
    - secretName: {{ .Values.secrets.kubernetesSecretName }}
      type: Opaque
      data:
        - objectName: GROQ_API_KEY
          key: GROQ_API_KEY
  parameters:
    objects: |
      - objectName: "{{ .Values.secrets.managerSecretId }}"
        objectType: "secretsmanager"
        jmesPath:
          - path: "GROQ_API_KEY"
            objectAlias: "GROQ_API_KEY"
```

- [ ] **Step 3: Add the Deployment, Service, and Ingress templates**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "golden-circle.fullname" . }}
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "golden-circle.name" . }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "golden-circle.name" . }}
    spec:
      serviceAccountName: {{ .Values.serviceAccount.name }}
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: 7001
          env:
            - name: GROQ_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secrets.kubernetesSecretName }}
                  key: GROQ_API_KEY
          readinessProbe:
            httpGet:
              path: /api/health
              port: 7001
          livenessProbe:
            httpGet:
              path: /api/health
              port: 7001
          volumeMounts:
            - name: secrets-store
              mountPath: /mnt/secrets-store
              readOnly: true
      volumes:
        - name: secrets-store
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: {{ include "golden-circle.fullname" . }}
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "golden-circle.fullname" . }}
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 7001
  selector:
    app.kubernetes.io/name: {{ include "golden-circle.name" . }}
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "golden-circle.fullname" . }}
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80}]'
    alb.ingress.kubernetes.io/healthcheck-path: /api/health
spec:
  ingressClassName: alb
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "golden-circle.fullname" . }}
                port:
                  number: 80
```

- [ ] **Step 4: Render and lint the chart locally**

Run: `helm lint deploy/helm/golden-circle && helm template golden-circle deploy/helm/golden-circle --set image.repository=example --set image.tag=test --set ingress.host=golden-circle.example.com --set serviceAccount.roleArn=arn:aws:iam::111111111111:role/golden-circle-app-runtime >/tmp/golden-circle-rendered.yaml`  
Expected: `helm lint` passes and `/tmp/golden-circle-rendered.yaml` contains Deployment, Service, Ingress, ServiceAccount, and SecretProviderClass manifests

- [ ] **Step 5: Commit**

```bash
git add deploy/helm/golden-circle
git commit -m "feat: add production helm chart"
```

### Task 6: Add GitHub Actions workflows for Terraform planning, protected apply, and production deploy

**Files:**

- Create: `.github/workflows/terraform-plan.yml`
- Create: `.github/workflows/terraform-apply.yml`
- Create: `.github/workflows/deploy-production.yml`
- Modify: `README.md`

- [ ] **Step 1: Create the Terraform plan workflow for pull requests**

```yaml
name: Terraform Plan

on:
  pull_request:
    paths:
      - "infra/**"
      - ".github/workflows/terraform-plan.yml"
      - ".github/workflows/terraform-apply.yml"

permissions:
  contents: read
  id-token: write

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: hashicorp/setup-terraform@v3
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_TERRAFORM_ROLE_ARN }}
          aws-region: ap-south-1
      - run: terraform -chdir=infra/environments/prod init -backend-config=backend.hcl.example
      - run: terraform -chdir=infra/environments/prod fmt -check -recursive
      - run: terraform -chdir=infra/environments/prod validate
      - run: terraform -chdir=infra/environments/prod plan -var-file=terraform.tfvars -out=tfplan
```

- [ ] **Step 2: Create the protected Terraform apply workflow**

```yaml
name: Terraform Apply

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  apply:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6
      - uses: hashicorp/setup-terraform@v3
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_TERRAFORM_ROLE_ARN }}
          aws-region: ap-south-1
      - run: terraform -chdir=infra/environments/prod init -backend-config=backend.hcl.example
      - run: terraform -chdir=infra/environments/prod apply -var-file=terraform.tfvars -auto-approve
```

- [ ] **Step 3: Create the production deploy workflow for merges to `main`**

```yaml
name: Deploy Production

on:
  push:
    branches: ["main"]

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ap-south-1
      - uses: aws-actions/amazon-ecr-login@v2
      - run: docker build -t "$ECR_REPOSITORY:${GITHUB_SHA}" .
      - run: docker push "$ECR_REPOSITORY:${GITHUB_SHA}"
      - run: aws eks update-kubeconfig --name golden-circle-prod --region ap-south-1
      - run: >
          helm upgrade --install golden-circle deploy/helm/golden-circle
          --namespace golden-circle
          --create-namespace
          --set image.repository="$ECR_REPOSITORY"
          --set image.tag="${GITHUB_SHA}"
          --set ingress.host="${APP_HOST}"
          --set serviceAccount.roleArn="${APP_SERVICE_ACCOUNT_ROLE_ARN}"
```

- [ ] **Step 4: Document the required GitHub repository variables and the deployment sequence**

```md
## AWS deployment variables

- `AWS_TERRAFORM_ROLE_ARN`
- `AWS_DEPLOY_ROLE_ARN`
- `ECR_REPOSITORY`
- `APP_HOST`
- `APP_SERVICE_ACCOUNT_ROLE_ARN`

## Production release sequence

1. Merge to `main`
2. Build and push image to ECR
3. Update kubeconfig through OIDC role assumption
4. Run `helm upgrade --install`
5. Verify `/api/health` and a real `/api/analyze` request
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/terraform-plan.yml .github/workflows/terraform-apply.yml .github/workflows/deploy-production.yml README.md
git commit -m "feat: add aws deployment workflows"
```

### Task 7: Perform production verification after the first apply and first deploy

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Populate the live Secrets Manager value before deploying the app**

Run: `aws secretsmanager put-secret-value --secret-id golden-circle/prod/runtime --secret-string "{\"GROQ_API_KEY\":\"$GROQ_API_KEY\"}" --region ap-south-1`  
Expected: AWS returns a new secret version ID for `golden-circle/prod/runtime`

- [ ] **Step 2: Apply infrastructure and deploy the first release**

Run: `gh workflow run "Terraform Apply"`  
Expected: the protected apply workflow succeeds and the EKS cluster, add-ons, IAM roles, hosted zone, and ECR repository exist

Run: `gh workflow run "Deploy Production"`  
Expected: the deploy workflow pushes the image to ECR and upgrades the Helm release in namespace `golden-circle`

- [ ] **Step 3: Verify in-cluster rollout health**

Run: `kubectl get pods -n golden-circle && kubectl get ingress -n golden-circle && kubectl describe secretproviderclass -n golden-circle`  
Expected: two healthy pods, one ALB-backed ingress, and one SecretProviderClass bound to the runtime secret

- [ ] **Step 4: Verify the public endpoint and the streaming API**

Run: `curl -fsS http://$APP_HOST/api/health`  
Expected: `{"status":"ok"}`

Run: `curl -N -X POST "http://$APP_HOST/api/analyze" -H "Content-Type: application/json" -d '{"businessIdea":"We build AI-powered bookkeeping software for Indian freelancers who need faster monthly close and GST-ready reporting without hiring a full-time accountant."}'`  
Expected: streamed plain-text output from the application, not a 4xx or 5xx response

- [ ] **Step 5: Commit the final README updates if they changed during verification**

```bash
git add README.md
git commit -m "docs: finalize aws production deployment guide"
```

## Assumptions and Defaults

- The public hosted zone will be created or updated in the same AWS account as the EKS cluster.
- The live production hostname defaults to the `golden-circle` subdomain under the configured Route 53 hosted zone.
- The ALB listens on HTTP:80 only. There is no ACM certificate, no TLS termination at the edge, and no HTTP→HTTPS redirect. If TLS becomes a requirement, reintroduce an `acm` module or front the ALB with CloudFront.
- The first production node group uses `t3.large` instances and on-demand capacity only.
- `kubernetes_version` is pinned to `1.35` because AWS shows EKS `1.35` released on January 27, 2026, with standard support through March 27, 2027.
- The app remains Groq-backed in v1; Bedrock migration is separate work.
- Terraform `apply` is intentionally manual and protected even though application deployment from `main` is automated.
