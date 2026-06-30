import axios from "axios";

// Single axios instance. `withCredentials` ensures the httpOnly auth
// cookie is sent with every request. The API lives under /api on the same
// backend host the socket connects to (VITE_SERVER_URL).
const api = axios.create({
  baseURL: `${import.meta.env.VITE_SERVER_URL}/api`,
  withCredentials: true,
});

export default api;
