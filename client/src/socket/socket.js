import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL;

// Singleton socket instance
const socket = io(SOCKET_URL, {
  withCredentials: true,
  autoConnect: true,
});

export default socket;
