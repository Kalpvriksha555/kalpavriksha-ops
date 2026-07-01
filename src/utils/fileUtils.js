export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

export const cleanFileName = (name = 'file') => String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
