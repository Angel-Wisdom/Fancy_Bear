/**
 * Suraksha 2.0 — API Utility
 * Fetch wrapper with JWT injection, error handling, and base URL config.
 */

const BASE_URL = '';

function getToken() {
  return localStorage.getItem('suraksha_token');
}

function buildHeaders(contentType = 'application/json') {
  const headers = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse(response) {
  if (response.status === 401) {
    localStorage.removeItem('suraksha_token');
    window.location.href = '/login';
    throw new Error('Session expired. Please login again.');
  }

  let data;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMessage = typeof data === 'object' && data.message
      ? data.message
      : typeof data === 'string'
        ? data
        : `Request failed with status ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  async get(url, params = {}) {
    const queryString = Object.keys(params).length
      ? '?' + new URLSearchParams(params).toString()
      : '';

    const response = await fetch(`${BASE_URL}${url}${queryString}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },

  async post(url, body, isFormData = false) {
    const options = {
      method: 'POST',
      headers: isFormData ? {} : buildHeaders(),
    };

    // Add auth header for FormData
    if (isFormData) {
      const token = getToken();
      if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${url}`, options);
    return handleResponse(response);
  },

  async put(url, body) {
    const response = await fetch(`${BASE_URL}${url}`, {
      method: 'PUT',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },

  async patch(url, body) {
    const response = await fetch(`${BASE_URL}${url}`, {
      method: 'PATCH',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },

  async delete(url) {
    const response = await fetch(`${BASE_URL}${url}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },

  async upload(url, formData, onProgress) {
    // For progress tracking we use XMLHttpRequest
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}${url}`);

      const token = getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(xhr.responseText);
          }
        } else if (xhr.status === 401) {
          localStorage.removeItem('suraksha_token');
          window.location.href = '/login';
          reject(new Error('Session expired'));
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            reject(new Error(errData.message || `Upload failed: ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  },
};

export default api;
