import { Navigate, useParams } from "react-router-dom";

export function RoomPage() {
  const { roomId = "" } = useParams();
  return <Navigate replace to={`/tables/${roomId}`} />;
}
