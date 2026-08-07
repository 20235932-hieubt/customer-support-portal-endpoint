require('dotenv').config();
const dns = require('dns');

// Ép Node.js sử dụng DNS của Google (chỉ chạy ở máy tính local) để fix lỗi mạng không đọc được SRV của MongoDB Atlas
if (process.env.NODE_ENV !== 'production') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
    console.log('🛠 Đã cấu hình DNS Google (8.8.8.8) cho project để sửa lỗi MongoDB Local.');
  } catch (err) {
    console.error('⚠️ Không thể cài DNS:', err);
  }
}

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

// Serverless MongoDB Connection Pattern
let isConnected = false;
async function connectToDatabase() {
  if (isConnected) return;
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/swagger-api-spec';
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout sau 5s nếu không kết nối được
    });
    isConnected = true;
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    throw err; // Ném lỗi để API biết mà xử lý
  }
}

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
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.0.0/swagger-ui-standalone-preset.min.js',
    '/custom.js'
  ],
  swaggerUrl: '/api/swagger.json', // Chỉ định Swagger UI lấy dữ liệu từ API này thay vì truyền cứng
  swaggerOptions: {
    supportedSubmitMethods: [] // Ẩn hoàn toàn nút "Try it out" cho mọi method
  }
};

// API trả về đoạn script gắn nút Admin vào trang Swagger
app.get('/custom.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    window.addEventListener('load', function() {
      const btn = document.createElement('a');
      btn.href = '/admin';
      btn.textContent = 'Trang Admin (Cập nhật API)';
      btn.style.position = 'fixed';
      btn.style.bottom = '20px';
      btn.style.right = '20px';
      btn.style.padding = '12px 24px';
      btn.style.background = '#007bff';
      btn.style.color = '#ffffff';
      btn.style.borderRadius = '50px';
      btn.style.textDecoration = 'none';
      btn.style.zIndex = '9999';
      btn.style.fontWeight = 'bold';
      btn.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
      btn.style.transition = 'background 0.3s';
      btn.onmouseover = () => btn.style.background = '#0056b3';
      btn.onmouseout = () => btn.style.background = '#007bff';
      document.body.appendChild(btn);
    });
  `);
});

// 1. API lấy JSON Spec (Swagger UI sẽ gọi API này)
app.get('/api/swagger.json', async (req, res) => {
  try {
    await connectToDatabase();
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

    await connectToDatabase();
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
app.get('/admin', async (req, res) => {
  let currentYaml = '';
  try {
    await connectToDatabase();
    const doc = await SwaggerDoc.findOne();
    if (doc && doc.content) {
      currentYaml = doc.content;
    } else {
      const localFilePath = path.join(__dirname, '..', 'swagger.yaml');
      if (fs.existsSync(localFilePath)) {
        currentYaml = fs.readFileSync(localFilePath, 'utf8');
      }
    }
  } catch (err) {
    console.error('Error fetching current YAML for admin:', err);
  }

  // Chống lỗi hiển thị HTML khi nạp vào textarea
  const escapedYaml = currentYaml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Update Swagger API</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f9; padding: 20px; max-width: 900px; margin: 0 auto; }
        h1 { color: #333; }
        textarea { width: 100%; height: 500px; padding: 12px; font-family: monospace; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; resize: vertical; white-space: pre; }
        button { margin-top: 15px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; margin-right: 10px;}
        button:hover { background: #0056b3; }
        #toast { position: fixed; top: 20px; right: -400px; max-width: 350px; padding: 15px 20px; border-radius: 8px; background: #4caf50; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: right 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55); z-index: 10000; font-weight: 500; display: flex; align-items: center; gap: 10px; }
        #toast.show { right: 20px; }
        #toast.error { background: #f44336; }
        #toast a { color: white; text-decoration: underline; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>Cập nhật Swagger (YAML)</h1>
      <p>Dưới đây là nội dung API hiện tại. Bạn có thể chỉnh sửa trực tiếp và lưu lại.</p>
      <textarea id="yamlInput" spellcheck="false">${escapedYaml}</textarea><br>
      <button onclick="updateSwagger()">Cập nhật API</button>
      <div id="toast"></div>

      <script>
        function showToast(message, isError = false) {
          const toast = document.getElementById('toast');
          toast.innerHTML = message;
          if (isError) toast.classList.add('error');
          else toast.classList.remove('error');
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 4000);
        }

        async function updateSwagger() {
          const yamlContent = document.getElementById('yamlInput').value;
          
          if (!yamlContent.trim()) {
            showToast('Vui lòng nhập nội dung YAML!', true);
            return;
          }

          showToast('Đang lưu...');

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
              showToast('✅ Cập nhật thành công! <a href="/" target="_blank">Xem ngay</a>');
            } else {
              showToast('❌ Lỗi: ' + data.error + (data.details ? ': ' + data.details : ''), true);
            }
          } catch (err) {
            showToast('❌ Lỗi mạng: ' + err.message, true);
          }
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
