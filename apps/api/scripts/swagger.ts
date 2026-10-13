import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'Wonder Money API',
    version: '1.0.0',
    description: 'Wonder Money API Documentation',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://staging.api.wonder.money',
      description: 'Staging server',
    },
    {
      url: 'https://api.wonder.money',
      description: 'Production server',
    },
  ],
  tags: [
    { name: 'Account', description: 'Account management and transactions' },
    { name: 'Auth', description: 'Authentication' },
    { name: 'Banking', description: 'Banking integrations' },
    { name: 'Budget', description: 'Budget management' },
    { name: 'Category', description: 'Transaction categories' },
    { name: 'Configs', description: 'Configuration endpoints' },
    { name: 'Financial Markets', description: 'Financial market data' },
    { name: 'Health', description: 'Health check' },
    { name: 'Marketing', description: 'Marketing operations' },
    { name: 'Portfolio', description: 'Investment portfolio management' },
    { name: 'Support', description: 'Support and feedback' },
    { name: 'User', description: 'User management' },
    { name: 'Admin', description: 'Admin operations' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: 'better-auth session cookie (automatically set during sign-in)',
      },
      adminApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Admin API key for admin endpoints',
      },
    },
  },
  security: [{ cookieAuth: [] }],
};

const outputFile = './src/generated/swagger.json';

// Point to app.ts which has the proper route mappings with prefixes
const routes = ['./src/app.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc).then(() => {
  console.log('Swagger documentation generated successfully!');
});
