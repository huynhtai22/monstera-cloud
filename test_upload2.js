const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const http = require('http');

async function upload() {
  try {
    const filePath = path.join(__dirname, 'massive_test_data.csv');
    const fileStream = fs.createReadStream(filePath);
    
    const form = new FormData();
    form.append('file', fileStream);
    form.append('workspaceId', 'test-workspace-id');

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/data-explorer/upload',
      method: 'POST',
      headers: form.getHeaders(),
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => console.log('Status:', res.statusCode, 'Data:', data));
    });

    form.pipe(req);
  } catch(e) {
    console.error(e);
  }
}
upload();
