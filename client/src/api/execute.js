import api from "./axios.js";

export const executeCode = (payload) =>
  api.post("/execute", payload).then((r) => r.data);
