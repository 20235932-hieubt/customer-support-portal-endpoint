require('dotenv').config();
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');

const app = express();
// Middleware để parse body dạng text/yaml (raw string)
app.use(express.text({ type: ['application/yaml', 'text/yaml', 'text/plain'], limit: '5mb' }));
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/swagger-api-spec';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Model for Swagger Spec
const SwaggerSchema = new mongoose.Schema({
  content: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const SwaggerDoc = mongoose.model('SwaggerDoc', SwaggerSchema);

// Cấu hình dùng CDN thay vì file static nội bộ để fix lỗi Vercel
const swaggerUiOptions = {
  customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui.min.css',
  customJs: [
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-standalone-preset.min.js'
  ],
  swaggerUrl: '/api/swagger.json' // Chỉ định Swagger UI lấy dữ liệu từ API này thay vì truyền cứng
};

// 1. API lấy JSON Spec (Swagger UI sẽ gọi API này)
app.get('/api/swagger.json', async (req, res) => {
  try {
    let doc = await SwaggerDoc.findOne();
    let yamlContent = '';

    if (doc && doc.content) {
      yamlContent = doc.content;
    } else {
      // Fallback: nếu DB chưa có gì, đọc từ file swagger.yaml gốc ban đầu
      const localFilePath = path.join(__dirname, '..', 'swagger.yaml');
      if (fs.existsSync(localFilePath)) {
        yamlContent = fs.readFileSync(localFilePath, 'utf8');
      } else {
        return res.status(404).json({ error: 'No Swagger spec found' });
      }
    }

    // Chuyển YAML sang JSON
    const jsonSpec = YAML.parse(yamlContent);
    res.json(jsonSpec);
  } catch (error) {
    console.error('Error fetching swagger:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. API nhận YAML mới và lưu đè vào MongoDB
app.post('/api/swagger', async (req, res) => {
  try {
    let yamlString = req.body;
    
    if (!yamlString || typeof yamlString !== 'string') {
      return res.status(400).json({ error: 'Body must be a valid YAML string (use Content-Type: text/plain)' });
    }

    // Validate: thử parse xem có đúng chuẩn YAML không
    try {
      YAML.parse(yamlString);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid YAML format', details: parseError.message });
    }

    // Upsert (Tìm và update bản ghi đầu tiên, hoặc tạo mới nếu chưa có)
    await SwaggerDoc.findOneAndUpdate(
      {}, 
      { content: yamlString, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Swagger documentation updated successfully!' });
  } catch (error) {
    console.error('Error updating swagger:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. API giao diện Admin để cập nhật Swagger YAML
app.get('/admin', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Update Swagger API</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f9; padding: 20px; max-width: 800px; margin: 0 auto; }
        h1 { color: #333; }
        textarea { width: 100%; height: 400px; padding: 12px; font-family: monospace; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; resize: vertical; }
        button { margin-top: 15px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        button:hover { background: #0056b3; }
        #message { margin-top: 15px; padding: 10px; border-radius: 4px; display: none; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
      </style>
    </head>
    <body>
      <h1>Cập nhật Swagger (YAML)</h1>
      <p>Dán nội dung YAML mới vào bên dưới và nhấn Cập nhật. Lưu ý: Cần kết nối MongoDB để hệ thống lưu lại.</p>
      <textarea id="yamlInput" placeholder="openapi: 3.0.0\ninfo:\n  title: Sample API\n..."></textarea><br>
      <button onclick="updateSwagger()">Cập nhật API</button>
      <div id="message"></div>

      <script>
        async function updateSwagger() {
          const yamlContent = document.getElementById('yamlInput').value;
          const msgDiv = document.getElementById('message');
          
          if (!yamlContent.trim()) {
            msgDiv.className = 'error';
            msgDiv.textContent = 'Vui lòng nhập nội dung YAML!';
            msgDiv.style.display = 'block';
            return;
          }

          msgDiv.style.display = 'none';

          try {
            const res = await fetch('/api/swagger', {
              method: 'POST',
              headers: {
                'Content-Type': 'text/plain'
              },
              body: yamlContent
            });

            const data = await res.json();
            
            if (res.ok) {
              msgDiv.className = 'success';
              msgDiv.innerHTML = data.message + ' <a href="/" target="_blank">Xem ngay</a>';
            } else {
              msgDiv.className = 'error';
              msgDiv.textContent = data.error + (data.details ? ': ' + data.details : '');
            }
          } catch (err) {
            msgDiv.className = 'error';
            msgDiv.textContent = 'Lỗi mạng: ' + err.message;
          }
          
          msgDiv.style.display = 'block';
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// 4. Phục vụ giao diện Swagger UI ở trang chủ (/)
// Set pass `null` vào document vì ta đã trỏ URL trong options
app.use('/', swaggerUi.serve, swaggerUi.setup(null, swaggerUiOptions));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;
