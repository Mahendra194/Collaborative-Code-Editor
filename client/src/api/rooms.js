import api from "./axios.js";

export const createRoom = (payload) =>
  api.post("/rooms/create", payload).then((r) => r.data.room);

export const getMyRooms = () =>
  api.get("/rooms/my-rooms").then((r) => r.data.rooms);

export const getRoom = (roomId) =>
  api.get(`/rooms/${roomId}`).then((r) => r.data.room);

export const getChatHistory = (roomId) =>
  api.get(`/rooms/${roomId}/chat`).then((r) => r.data.messages);

export const getHistory = (roomId) =>
  api.get(`/rooms/${roomId}/history`).then((r) => r.data.events);

export const createSnapshot = (roomId) =>
  api.post(`/rooms/${roomId}/history/snapshot`).then((r) => r.data.event);

export const deleteRoom = (roomId) =>
  api.delete(`/rooms/${roomId}`).then((r) => r.data);

export const toggleLock = (roomId) =>
  api.patch(`/rooms/${roomId}/lock`).then((r) => r.data.room);
