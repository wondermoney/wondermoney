{{/*
Names. `fullname` is the release name, with the chart name added when the release name does not
contain it, cut to the 63 characters a Kubernetes name allows.
*/}}
{{- define "wondermoney.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "wondermoney.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* A component's name: <fullname>-api, -worker, -web, -postgresql. Kept short enough for a Service. */}}
{{- define "wondermoney.componentName" -}}
{{- printf "%s-%s" (include "wondermoney.fullname" .root | trunc (int (sub 62 (len .component))) | trimSuffix "-") .component }}
{{- end }}

{{- define "wondermoney.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "wondermoney.selectorLabels" . }}
app.kubernetes.io/version: {{ include "wondermoney.imageTag" (dict "root" . "image" dict) | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "wondermoney.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wondermoney.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Labels of one component, `dict "root" $ "component" "api"`. */}}
{{- define "wondermoney.componentLabels" -}}
{{ include "wondermoney.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "wondermoney.componentSelectorLabels" -}}
{{ include "wondermoney.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/* The image tag: the component's own, then `image.tag`, then the chart's appVersion. */}}
{{- define "wondermoney.imageTag" -}}
{{- .image.tag | default .root.Values.image.tag | default .root.Chart.AppVersion }}
{{- end }}

{{/* `dict "root" $ "image" .Values.api.image` */}}
{{- define "wondermoney.image" -}}
{{- printf "%s:%s" .image.repository (include "wondermoney.imageTag" .) }}
{{- end }}

{{- define "wondermoney.configName" -}}
{{- printf "%s-config" (include "wondermoney.fullname" .) }}
{{- end }}

{{/* Generated once and kept: the secrets the API refuses to start without, and the bundled Postgres password. */}}
{{- define "wondermoney.generatedSecretName" -}}
{{- printf "%s-generated" (include "wondermoney.fullname" .) }}
{{- end }}

{{/* What `secrets:` and the database settings in values hold. */}}
{{- define "wondermoney.secretName" -}}
{{- printf "%s-secrets" (include "wondermoney.fullname" .) }}
{{- end }}

{{/* The `secrets:` entries that are set. */}}
{{- define "wondermoney.secretValues" -}}
{{- $out := dict }}
{{- range $key, $value := .Values.secrets }}
{{- if ne (toString $value) "" }}
{{- $_ := set $out $key (toString $value) }}
{{- end }}
{{- end }}
{{- if not .Values.postgresql.enabled }}
{{- if .Values.database.url }}
{{- $_ := set $out "DATABASE_URL" .Values.database.url }}
{{- else if .Values.database.password }}
{{- $_ := set $out "DB_PASSWORD" (toString .Values.database.password) }}
{{- end }}
{{- end }}
{{- toYaml $out }}
{{- end }}

{{/*
APP_URL and API_URL. With an Ingress and no URLs set, they follow its hosts: one hostname serves
both, two give the API its own.
*/}}
{{- define "wondermoney.appUrl" -}}
{{- $scheme := ternary "https" "http" (gt (len .Values.ingress.tls) 0) }}
{{- if .Values.config.APP_URL }}
{{- .Values.config.APP_URL | trimSuffix "/" }}
{{- else if and .Values.ingress.enabled .Values.ingress.host }}
{{- printf "%s://%s" $scheme .Values.ingress.host }}
{{- else }}
{{- "http://localhost:3000" }}
{{- end }}
{{- end }}

{{- define "wondermoney.apiUrl" -}}
{{- $scheme := ternary "https" "http" (gt (len .Values.ingress.tls) 0) }}
{{- if .Values.config.API_URL }}
{{- .Values.config.API_URL | trimSuffix "/" }}
{{- else if and .Values.ingress.enabled .Values.ingress.apiHost }}
{{- printf "%s://%s" $scheme .Values.ingress.apiHost }}
{{- else if and .Values.ingress.enabled .Values.ingress.host }}
{{- printf "%s://%s" $scheme .Values.ingress.host }}
{{- else }}
{{- "http://localhost:3001" }}
{{- end }}
{{- end }}

{{/* TRUST_PROXY: as set, or 1 behind the chart's Ingress (the ingress controller is one proxy). */}}
{{- define "wondermoney.trustProxy" -}}
{{- if ne (toString .Values.config.TRUST_PROXY) "" }}
{{- toString .Values.config.TRUST_PROXY }}
{{- else if .Values.ingress.enabled }}
{{- "1" }}
{{- end }}
{{- end }}

{{/* The database settings the API and the worker share, as container env entries. */}}
{{- define "wondermoney.databaseEnv" -}}
{{- if .Values.postgresql.enabled }}
- name: DB_HOST
  value: {{ include "wondermoney.componentName" (dict "root" . "component" "postgresql") | quote }}
- name: DB_PORT
  value: "5432"
- name: DB_DATABASE
  value: {{ .Values.postgresql.auth.database | quote }}
- name: DB_USERNAME
  value: {{ .Values.postgresql.auth.username | quote }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "wondermoney.generatedSecretName" . }}
      key: POSTGRES_PASSWORD
{{- else if and .Values.database.existingSecret .Values.database.existingSecretUrlKey }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: {{ .Values.database.existingSecretUrlKey }}
{{- else if .Values.database.url }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "wondermoney.secretName" . }}
      key: DATABASE_URL
{{- else if .Values.database.host }}
- name: DB_HOST
  value: {{ .Values.database.host | quote }}
- name: DB_PORT
  value: {{ .Values.database.port | quote }}
- name: DB_DATABASE
  value: {{ .Values.database.name | quote }}
- name: DB_USERNAME
  value: {{ .Values.database.user | quote }}
{{- if .Values.database.existingSecret }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: {{ .Values.database.existingSecretPasswordKey }}
{{- else if .Values.database.password }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "wondermoney.secretName" . }}
      key: DB_PASSWORD
{{- end }}
{{- else }}
{{- fail "WonderMoney needs Postgres: set database.host (or database.url) for your own database, or postgresql.enabled=true for the bundled one." }}
{{- end }}
{{- end }}

{{/* Where the API and the worker read their settings: the config map, then the secrets, later ones winning. */}}
{{- define "wondermoney.serverEnvFrom" -}}
- configMapRef:
    name: {{ include "wondermoney.configName" . }}
- secretRef:
    name: {{ include "wondermoney.generatedSecretName" . }}
- secretRef:
    name: {{ include "wondermoney.secretName" . }}
{{- if .Values.existingSecret }}
- secretRef:
    name: {{ .Values.existingSecret }}
{{- end }}
{{- end }}

{{/* Where the API and the worker read the instance-wide Enable Banking key, from `enableBanking.privateKeySecret`. */}}
{{- define "wondermoney.enableBankingKeyDir" -}}
/etc/wondermoney/enable-banking
{{- end }}

{{- define "wondermoney.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "wondermoney.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
{{- end }}

{{/* Settings the chart refuses, checked on every render. */}}
{{- define "wondermoney.validate" -}}
{{- range $key := list "replicas" "replicaCount" "autoscaling" }}
{{- if hasKey $.Values.worker $key }}
{{- fail (printf "worker.%s is not a setting: the worker runs the schedules, so the chart always runs exactly one." $key) }}
{{- end }}
{{- end }}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) }}
{{- fail "ingress.host is required with ingress.enabled: the web app's hostname (and the API's too, without ingress.apiHost)." }}
{{- end }}
{{- if and .Values.ingress.enabled .Values.ingress.apiHost (eq .Values.ingress.apiHost .Values.ingress.host) }}
{{- fail "ingress.apiHost must differ from ingress.host; leave it empty to serve the API on the web app's hostname." }}
{{- end }}
{{- $appHost := (urlParse (include "wondermoney.appUrl" .)).hostname }}
{{- $apiHost := (urlParse (include "wondermoney.apiUrl" .)).hostname }}
{{- if and (ne $appHost $apiHost) (or (not .Values.config.AUTH_COOKIE_DOMAIN) (not .Values.config.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN)) }}
{{- fail "Two hostnames (the web app and the API on different hosts) need config.AUTH_COOKIE_DOMAIN and config.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN, both the shared parent domain with a leading dot (such as .example.com), so the web app can read the session cookie the API sets." }}
{{- end }}
{{- if and .Values.config.ENABLE_BANKING_APP_ID (not .Values.enableBanking.privateKeySecret) }}
{{- fail "config.ENABLE_BANKING_APP_ID needs enableBanking.privateKeySecret, the Secret holding the Enable Banking application's private key." }}
{{- end }}
{{- if and .Values.enableBanking.privateKeySecret (not .Values.config.ENABLE_BANKING_APP_ID) }}
{{- fail "enableBanking.privateKeySecret needs config.ENABLE_BANKING_APP_ID, the Enable Banking application's id." }}
{{- end }}
{{- if and (not .Values.generatedSecrets.enabled) (not .Values.existingSecret) }}
{{- range $key := list "BETTER_AUTH_SECRET" "CREDENTIAL_ENCRYPTION_KEY_V1" "EMAIL_OPT_OUT_SIGNING_SECRET" "ADMIN_API_KEY" "INTERNAL_SERVICE_API_KEY" }}
{{- if eq (toString (get $.Values.secrets $key)) "" }}
{{- fail (printf "With generatedSecrets.enabled=false, provide %s (and the other generated secrets) in existingSecret or secrets." $key) }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
The keys of the generated Secret: the API's required secrets that `secrets` does not set, and the
bundled Postgres password.
*/}}
{{- define "wondermoney.generatedSecretKeys" -}}
{{- $keys := list }}
{{- if .Values.generatedSecrets.enabled }}
{{- range $key := list "BETTER_AUTH_SECRET" "CREDENTIAL_ENCRYPTION_KEY_V1" "EMAIL_OPT_OUT_SIGNING_SECRET" "ADMIN_API_KEY" "INTERNAL_SERVICE_API_KEY" }}
{{- if eq (toString (get $.Values.secrets $key)) "" }}
{{- $keys = append $keys $key }}
{{- end }}
{{- end }}
{{- end }}
{{- if .Values.postgresql.enabled }}
{{- $keys = append $keys "POSTGRES_PASSWORD" }}
{{- end }}
{{- toYaml $keys }}
{{- end }}
