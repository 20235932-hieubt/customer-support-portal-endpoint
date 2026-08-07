const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const app = express();

// Load the swagger.yaml file from the project root
const swaggerDocument = YAML.load(path.join(process.cwd(), 'swagger.yaml'));

// Serve Swagger UI at the root path '/'
app.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// For local testing (Vercel will ignore this and use the exported app)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

// Export the Express API for Vercel Serverless Functions
module.exports = app;
