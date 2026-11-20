// Hand-written icon rules, shared by the pack generator (build/icons.mjs) and
// the engine (build/entry.mjs). The generated index maps product names to
// icons; this file holds what a name list cannot know: acronyms, cloud
// vendors, and the generic glyphs used when no product matches.

/** Pack format version (index and shards). Bump when their layout changes. */
export const PACK_VERSION = 1
/** Number of shard chunks (`client.icons-XX.js`). Changing it is a pack format change. */
export const SHARDS = 256

/**
 * Lookup key of a name: lower case, no accents, no punctuation, so that
 * "Node.js", "nodejs" and "NODE JS" meet. `+` and `#` keep a meaning (C++, C#).
 */
export function iconKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]/g, '')
}

/** Shard (0..SHARDS-1) holding an icon id: FNV-1a of the id. */
export function shardOf(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % SHARDS
}

/** File name of a shard chunk. */
export const shardFile = (n) => `client.icons-${String(n).padStart(3, '0')}.js`

/**
 * Cloud vendors. Their service icons ("Lambda", "Functions", "Firewall")
 * often carry common words: a bare service name only matches inside a
 * vendor context (the element, or one of its groups, names the vendor), or
 * when the name is distinctive. `words` are the keys that set the context.
 */
export const VENDORS = {
  aws: { words: ['aws', 'amazon', 'amazonwebservices'], prefixes: ['aws', 'amazon'] },
  azure: { words: ['azure', 'microsoftazure'], prefixes: ['azure', 'microsoftazure'] },
  gcp: { words: ['gcp', 'googlecloud', 'googlecloudplatform'], prefixes: ['gcp', 'google', 'googlecloud'] },
}

/** Words dropped from the front of a product name to make a second key ("Apache Kafka" → "kafka"). */
export const NAME_PREFIXES = ['apache', 'hashicorp', 'amazon', 'aws', 'azure', 'microsoft', 'google', 'gcp', 'ibm', 'the']
/** Words dropped from the end of a cloud service name ("OpenSearch Service" → "opensearch"). */
export const CLOUD_SUFFIXES = ['services', 'service', 'accounts', 'account', 'instances', 'clusters', 'workspaces', 'apps']

/**
 * Acronyms and usual short names. Key → target: an icon id (`set:name`),
 * or `=key` to reuse whatever icon an existing key resolves to. Cloud
 * entries are scoped by vendor; `brand` entries apply everywhere.
 */
export const ALIASES = {
  brand: {
    // cloud vendors themselves
    aws: 'tech:amazon-web-services', amazonwebservices: 'tech:amazon-web-services',
    azure: 'tech:microsoft-azure', microsoftazure: 'tech:microsoft-azure',
    gcp: 'tech:google-cloud', googlecloud: 'tech:google-cloud', googlecloudplatform: 'tech:google-cloud',
    // usual short names
    postgres: '=postgresql', pg: '=postgresql', psql: '=postgresql', pgsql: '=postgresql',
    k8s: '=kubernetes', kube: '=kubernetes', kubectl: '=kubernetes',
    mongo: '=mongodb', es: '=elasticsearch',
    otel: '=opentelemetry', gha: '=githubactions', ghactions: '=githubactions',
    windows: 'tech:microsoft-windows-icon', windowsserver: 'tech:microsoft-windows-icon',
    mssql: 'tech:microsoft-sql-server', sqlserver: 'tech:microsoft-sql-server',
    rhel: '=redhat', redhatenterpriselinux: '=redhat', sles: '=suse',
    lambda: 'aws:lambda', cuda: '=nvidia', tensorrt: '=nvidia', tensorrtllm: '=nvidia', triton: '=nvidia',
    ggml: '=llamacpp', gguf: '=llamacpp',
    vscode: '=visualstudiocode', dockerfile: '=docker', containerfile: '=docker', golang: '=go', js: '=javascript', ts: '=typescript', py: '=python',
    hf: '=huggingface', gpt: '=openai', chatgpt: '=openai',
    rmq: '=rabbitmq', amqp: '=rabbitmq',
    pve: '=proxmox', proxmoxve: '=proxmox', esxi: '=vmware', vsphere: '=vmware', vcenter: '=vmware',
  },
  aws: {
    s3: 'aws:simple-storage-service', glacier: 'aws:simple-storage-service-glacier',
    sqs: 'aws:simple-queue-service', sns: 'aws:simple-notification-service', ses: 'aws:simple-email-service',
    ebs: 'aws:elastic-block-store', ecr: 'aws:elastic-container-registry', ecs: 'aws:elastic-container-service',
    eks: 'aws:elastic-kubernetes-service', kubernetes: 'aws:elastic-kubernetes-service',
    elb: 'aws:elastic-load-balancing', alb: 'aws:elastic-load-balancing', nlb: 'aws:elastic-load-balancing', loadbalancer: 'aws:elastic-load-balancing',
    iam: 'aws:identity-and-access-management', sso: 'aws:iam-identity-center', kms: 'aws:key-management-service',
    vpc: 'aws:virtual-private-cloud', msk: 'aws:managed-streaming-for-apache-kafka', kafka: 'aws:managed-streaming-for-apache-kafka',
    mwaa: 'aws:managed-workflows-for-apache-airflow', airflow: 'aws:managed-workflows-for-apache-airflow',
    amp: 'aws:managed-service-for-prometheus', prometheus: 'aws:managed-service-for-prometheus',
    amg: 'aws:managed-grafana', grafana: 'aws:managed-grafana',
    ssm: 'aws:systems-manager', acm: 'aws:certificate-manager', cdk: 'aws:cloud-development-kit',
    dms: 'aws:database-migration-service', cloudformation: 'aws:cloud-formation', cfn: 'aws:cloud-formation',
    asg: 'aws:auto-scaling', autoscalinggroup: 'aws:auto-scaling', ami: 'aws:ec2-image-builder',
    elasticsearch: 'aws:open-search-service', opensearch: 'aws:open-search-service',
    redis: 'aws:elasti-cache', memcached: 'aws:elasti-cache', inferentia: 'aws:neuron', trainium: 'aws:neuron',
    vm: 'aws:ec2', instance: 'aws:ec2', instances: 'aws:ec2',
  },
  azure: {
    aks: 'azure:kubernetes-services', kubernetes: 'azure:kubernetes-services',
    acr: 'azure:container-registries', aci: 'azure:container-instances',
    vm: 'azure:virtual-machine', vms: 'azure:virtual-machine', virtualmachines: 'azure:virtual-machine',
    vnet: 'azure:virtual-networks', virtualnetwork: 'azure:virtual-networks', nsg: 'azure:network-security-groups',
    apim: 'azure:api-management-services', apimanagement: 'azure:api-management-services',
    appservice: 'azure:app-services', webapp: 'azure:app-services',
    functions: 'azure:function-apps', functionapp: 'azure:function-apps', azurefunctions: 'azure:function-apps',
    eventhub: 'azure:event-hubs', keyvault: 'azure:key-vaults', blob: 'azure:storage-accounts', blobstorage: 'azure:storage-accounts', storage: 'azure:storage-accounts', storageaccount: 'azure:storage-accounts',
    cosmos: 'azure:azure-cosmos-db', cosmosdb: 'azure:azure-cosmos-db', servicebus: 'azure:azure-service-bus',
    sql: 'azure:sql-database', sqldatabase: 'azure:sql-database', openai: 'azure:azure-open-ai', databricks: 'azure:azure-databricks',
    loganalytics: 'azure:log-analytics-workspaces', frontdoor: 'azure:front-door-and-cdn-profiles',
    appgateway: 'azure:application-gateways', applicationgateway: 'azure:application-gateways', agw: 'azure:application-gateways',
    firewall: 'azure:firewalls', loadbalancer: 'azure:load-balancers', lb: 'azure:load-balancers',
    sentinel: 'azure:azure-sentinel', devops: 'azure:azure-dev-ops', redis: 'azure:cache-redis', grafana: 'azure:azure-managed-grafana',
  },
  gcp: {
    gke: 'gcp:google-kubernetes-engine', kubernetes: 'gcp:google-kubernetes-engine',
    gce: 'gcp:compute-engine', vm: 'gcp:compute-engine', gcs: 'gcp:cloud-storage', storage: 'gcp:cloud-storage', bucket: 'gcp:cloud-storage',
    bq: 'gcp:big-query', bigquery: 'gcp:big-query', pubsub: 'gcp:pub-sub', cloudrun: 'gcp:cloud-run', cloudsql: 'gcp:cloud-sql',
    vertex: 'gcp:vertex-ai', vertexai: 'gcp:vertex-ai', iam: 'gcp:identity-and-access-management', kms: 'gcp:key-management-service',
    airflow: 'gcp:cloud-composer', composer: 'gcp:cloud-composer', redis: 'gcp:memorystore',
  },
}

/**
 * Cloud service keys that name one service whatever the context (acronyms
 * and brand-like names): "EKS" or "DynamoDB" alone get the AWS icon. Every
 * other service name needs the vendor in scope.
 */
export const VENDOR_BARE = {
  aws: ['s3', 'sqs', 'sns', 'ses', 'ebs', 'efs', 'ecr', 'ecs', 'eks', 'elb', 'alb', 'nlb', 'msk', 'mwaa', 'ssm', 'cdk', 'cfn', 'asg', 'ec2', 'rds',
    'dynamodb', 'sagemaker', 'cloudfront', 'cloudwatch', 'cloudtrail', 'cloudformation', 'eventbridge', 'elasticache', 'redshift', 'athena',
    'fargate', 'kinesis', 'stepfunctions', 'appsync', 'route53', 'lightsail', 'guardduty', 'cognito', 'emr', 'documentdb', 'neptune', 'keyspaces', 'inferentia', 'trainium'],
  azure: ['aks', 'acr', 'aci', 'apim', 'cosmosdb', 'servicebus', 'eventhubs', 'eventhub', 'keyvault', 'frontdoor', 'loganalytics', 'synapseanalytics', 'appservice', 'functionapp', 'azurefunctions'],
  gcp: ['gke', 'gce', 'gcs', 'bq', 'bigquery', 'pubsub', 'cloudrun', 'cloudsql', 'vertexai', 'dataflow', 'dataproc', 'spanner', 'bigtable', 'firestore', 'memorystore', 'cloudcomposer'],
}

/**
 * Words of the trade that are not products, on top of common English: a
 * product named like one only matches a technology field or a whole title.
 * Every glyph word below counts too.
 */
export const TECH_WORDS = ['api', 'apis', 'app', 'apps', 'sdk', 'cli', 'ui', 'ux', 'web', 'vm', 'iot', 'db', 'sql', 'http', 'https', 'rest', 'json', 'xml', 'yaml', 'csv',
  'ssh', 'tcp', 'udp', 'ip', 'dns', 'cdn', 'lan', 'wan', 'vpn', 'saas', 'paas', 'iaas', 'prod', 'dev', 'test', 'staging', 'qa', 'ops', 'devops', 'admin',
  'core', 'hub', 'portal', 'cloud', 'edge', 'node', 'nodes', 'stack', 'platform', 'engine', 'studio', 'center', 'manager', 'agent', 'agents', 'connect',
  'data', 'analytics', 'insights', 'labs', 'lab', 'live', 'one', 'go', 'pay', 'run', 'shell', 'code', 'build', 'deploy', 'release', 'flow', 'flows']

/** File names as titles ("Cart.tsx", "main.py"): extension → `=key` of the language or tool. */
export const EXTENSIONS = {
  ts: '=typescript', mts: '=typescript', cts: '=typescript', tsx: '=react', jsx: '=react', js: '=javascript', mjs: '=javascript', cjs: '=javascript',
  py: '=python', ipynb: '=jupyter', go: '=go', rs: '=rust', java: '=java', kt: '=kotlin', rb: '=ruby', php: '=php', cs: '=csharp',
  cpp: '=cplusplus', cc: '=cplusplus', hpp: '=cplusplus', c: '=c', h: '=c', swift: '=swift', scala: '=scala', lua: '=lua', r: '=r',
  sh: '=bash', bash: '=bash', zsh: '=bash', ps1: '=powershell', tf: '=terraform', hcl: '=terraform', yml: '=yaml', yaml: '=yaml',
  json: '=json', md: '=markdown', html: '=html5', css: '=css3', scss: '=sass', vue: '=vuejs', svelte: '=svelte',
  graphql: '=graphql', toml: '=toml', dockerfile: '=docker', nix: '=nixos', ex: '=elixir', exs: '=elixir',
}

/**
 * Generic glyphs (Bootstrap Icons) when no product matches: the words of
 * the technology or the title tell what the element does. English and
 * French, matched as whole words (keys). First listed wins.
 */
export const GLYPH_WORDS = [
  ['bootstrap:inboxes', ['queue', 'queues', 'topic', 'topics', 'broker', 'brokers', 'bus', 'eventbus', 'messagebus', 'stream', 'streams', 'streaming', 'pubsub', 'filedattente', 'evenements', 'messaging', 'messages', 'buffer', 'tampon']],
  ['bootstrap:lightning-charge', ['cache', 'caches', 'memcache']],
  ['bootstrap:database', ['database', 'databases', 'db', 'sql', 'nosql', 'rdbms', 'oltp', 'basededonnees', 'bdd', 'sgbd', 'datawarehouse', 'warehouse', 'entrepot', 'lakehouse', 'datalake']],
  ['bootstrap:search', ['search', 'index', 'indexes', 'indices', 'recherche', 'indexation', 'vectorstore', 'vectordb', 'vectors', 'embeddings']],
  ['bootstrap:bucket', ['bucket', 'buckets', 'objectstorage', 'objectstore', 'blob', 'blobs', 'stockage', 'storage', 'archive', 'archives']],
  ['bootstrap:diagram-3', ['loadbalancer', 'lb', 'balancer', 'proxy', 'reverseproxy', 'ingress', 'repartiteur', 'repartition', 'haproxy']],
  ['bootstrap:bricks', ['firewall', 'firewalls', 'parefeu', 'waf', 'acl', 'filtrage']],
  ['bootstrap:signpost-split', ['dns', 'resolver', 'resolveur', 'nameserver']],
  ['bootstrap:globe2', ['cdn', 'internet', 'web', 'website', 'site', 'portal', 'portail', 'public']],
  ['bootstrap:shield-lock', ['vpn', 'tunnel', 'zerotrust', 'bastion', 'jumphost', 'rebond', 'security', 'securite', 'pki', 'tls', 'certificates', 'certificats']],
  ['bootstrap:key', ['auth', 'authentication', 'authentification', 'sso', 'idp', 'oauth', 'oidc', 'saml', 'identity', 'identite', 'iam', 'secrets', 'secret', 'vault', 'coffre', 'keys', 'cles', 'login']],
  ['bootstrap:door-open', ['gateway', 'apigateway', 'passerelle', 'entry', 'entree', 'edge', 'frontal']],
  ['bootstrap:activity', ['monitoring', 'metrics', 'metriques', 'supervision', 'observability', 'observabilite', 'alerting', 'alertes', 'alerts', 'apm', 'tracing', 'traces', 'dashboards', 'dashboard', 'tableaudebord']],
  ['bootstrap:journal-text', ['logs', 'logging', 'log', 'journaux', 'journal', 'audit', 'syslog', 'events']],
  ['bootstrap:clock-history', ['scheduler', 'cron', 'crons', 'jobs', 'job', 'batch', 'batches', 'planificateur', 'ordonnanceur', 'orchestrator', 'orchestrateur', 'workflow', 'workflows', 'pipeline', 'pipelines', 'etl', 'elt']],
  ['bootstrap:robot', ['llm', 'llms', 'ai', 'ia', 'model', 'models', 'modele', 'modeles', 'inference', 'agent', 'agents', 'chatbot', 'assistant', 'ml', 'embedding']],
  ['bootstrap:gpu-card', ['gpu', 'gpus', 'accelerator', 'accelerateur', 'cuda']],
  ['bootstrap:cpu', ['cpu', 'cpus', 'processor', 'processeur', 'compute', 'calcul']],
  ['bootstrap:device-hdd', ['disk', 'disks', 'disque', 'disques', 'ssd', 'nvme', 'hdd', 'volume', 'volumes', 'raid', 'nfs', 'filesystem', 'fs']],
  ['bootstrap:hdd-network', ['cluster', 'clusters', 'nodes', 'noeuds', 'grappe', 'farm', 'ferme', 'pool']],
  ['bootstrap:box-seam', ['container', 'containers', 'conteneur', 'conteneurs', 'pod', 'pods', 'registry', 'registre']],
  ['bootstrap:router', ['network', 'networks', 'reseau', 'reseaux', 'switch', 'router', 'routeur', 'vlan', 'subnet', 'lan', 'wan', 'nat', 'peering']],
  ['bootstrap:hdd-stack', ['server', 'servers', 'serveur', 'serveurs', 'host', 'hosts', 'hote', 'hotes', 'vm', 'vms', 'baremetal', 'machine', 'machines', 'hypervisor', 'hyperviseur', 'instance', 'instances']],
  ['bootstrap:envelope', ['mail', 'email', 'smtp', 'imap', 'courriel', 'notification', 'notifications']],
  ['bootstrap:cloud-arrow-up', ['backup', 'backups', 'sauvegarde', 'sauvegardes', 'snapshot', 'snapshots', 'replication']],
  ['bootstrap:window', ['ui', 'frontend', 'front', 'webapp', 'spa', 'browser', 'navigateur', 'interface', 'console', 'gui']],
  ['bootstrap:phone', ['mobile', 'android', 'ios', 'smartphone']],
  ['bootstrap:terminal', ['cli', 'shell', 'terminal', 'script', 'scripts', 'ssh']],
  ['bootstrap:git', ['git', 'repo', 'repository', 'depot', 'ci', 'cd', 'cicd']],
  ['bootstrap:braces', ['api', 'apis', 'rest', 'grpc', 'graphql', 'sdk', 'library', 'librairie', 'lib', 'module']],
  ['bootstrap:gear', ['config', 'configuration', 'settings', 'parametres', 'worker', 'workers', 'daemon', 'service', 'services', 'microservice', 'microservices']],
  ['bootstrap:file-earmark-text', ['doc', 'docs', 'document', 'documents', 'documentation', 'wiki', 'readme', 'spec', 'specification', 'runbook', 'report', 'rapport']],
  ['bootstrap:person', ['user', 'users', 'utilisateur', 'utilisateurs', 'customer', 'customers', 'operator', 'operateur', 'admin', 'admins', 'team', 'equipe']],
]

/** Glyph of an element kind, the last resort for a leaf (groups get none). */
export const KIND_GLYPHS = {
  data: 'bootstrap:database',
  machine: 'bootstrap:hdd-stack',
  hardware: 'bootstrap:cpu',
  doc: 'bootstrap:file-earmark-text',
  external: 'bootstrap:cloud',
  service: 'bootstrap:gear',
  component: 'bootstrap:puzzle',
}

/** Every glyph the rules may pick (the generator checks they exist). */
export const GLYPHS = [...new Set([...GLYPH_WORDS.map(([id]) => id), ...Object.values(KIND_GLYPHS)])]
