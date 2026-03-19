const fs = require('fs');
const path = require('path');

async function upload() {
  try {
    const filePath = path.join(__dirname, 'massive_test_data.csv');
    const fileStream = fs.createReadStream(filePath);
    
    // Use manual multipart construction to avoid heavy dependencies in a quick script
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileStream);
    form.append('workspaceId', 'test-workspace-id'); // Doesn't matter if it fails auth first

    // We might need an actual session cookie, so let's just see if it fails at the body parsing level first
    const res = await fetch('http://localhost:3000/api/data-explorer/upload', {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch(e) {
    console.error(e);
  }
}
upload();
