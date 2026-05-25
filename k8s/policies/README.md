# Kyverno policies

Policy-as-code for the Kubernetes deployment. These `ClusterPolicy` resources
encode the same security posture the manifests already follow, so drift is
caught automatically rather than by review.

## Policies

| Policy | Enforces |
|---|---|
| `require-run-as-nonroot` | Pod or every container sets `runAsNonRoot: true` |
| `disallow-privilege-escalation` | Every container sets `allowPrivilegeEscalation: false` |
| `require-drop-all-capabilities` | Every container drops `ALL` capabilities |
| `require-resource-limits` | Every container declares cpu/memory requests **and** limits |
| `disallow-latest-tag` | Images carry an explicit, non-`:latest` tag |

## Audit, not Enforce

All policies use `validationFailureAction: Audit`. They **report** violations
(via PolicyReports) rather than block admission, so they can be adopted in a
shared cluster without breaking unrelated workloads. Flip to `Enforce` once the
cluster owner is ready to hard-gate admission.

## Known audited exception

`k8s/deployment.yaml` intentionally uses `image: golden-circle:latest` with
`imagePullPolicy: Never` for the Minikube proof-of-concept (the image is
side-loaded into Minikube's Docker daemon, never pulled). `disallow-latest-tag`
therefore reports this manifest. The documented production step — pinning a GHCR
digest published by CI — resolves it. This is why CI runs `kyverno apply`
against the live manifests in **report** mode and gates only on `kyverno test`.

## Testing

`tests/` contains a `kyverno test` suite with two fixtures (`good-pod`,
`bad-pod`) proving each policy passes compliant pods and fails violations. CI
runs it on every push/PR:

```bash
kyverno test k8s/policies/tests/
```

Run policies against the live manifests locally (report mode):

```bash
kyverno apply k8s/policies/ --resource k8s/deployment.yaml --audit-warn
```
