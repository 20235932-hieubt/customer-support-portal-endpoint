const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const app = express();

// Sử dụng __dirname để trỏ chính xác đến thư mục gốc, tránh lỗi sai đường dẫn trên Vercel
const swaggerDocument = YAML.load(path.join(__dirname, '..', 'swagger.yaml'));

// Cấu hình dùng CDN thay vì file static nội bộ, vì Vercel serverless function 
// thường không phục vụ tốt các file tĩnh bên trong node_modules của swagger-ui-express
const options = {
  customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui.min.css',
  customJs: [
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-standalone-preset.min.js'
  ]
};

app.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;

