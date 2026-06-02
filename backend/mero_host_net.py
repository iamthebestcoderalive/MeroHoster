import base64
import logging
import os
import socket
import struct
import sys
import threading
import time
import json

# --- Logging Setup ---
logger = logging.getLogger("MeroHostNet")


# --- STUN UTILITY ---
def get_public_ip_port(bind_port=0):
    """
    Retrieves the external Public IP and Port using a STUN Binding Request.
    """
    stun_server = "stun.l.google.com"
    stun_port = 19302

    transaction_id = os.urandom(12)
    packet = struct.pack(">HHI12s", 0x0001, 0x0000, 0x2112A442, transaction_id)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(('0.0.0.0', bind_port))
    except Exception as e:
        logger.error(f"Failed to bind UDP port {bind_port}, falling back to 0: {e}")
        sock.bind(('0.0.0.0', 0))
        
    sock.settimeout(2.0)
    try:
        sock.sendto(packet, (stun_server, stun_port))
        data, addr = sock.recvfrom(2048)
        msg_type, msg_len, cookie, tid = struct.unpack(">HHI12s", data[:20])

        offset = 20
        while offset < 20 + msg_len:
            if offset + 4 > len(data):
                break
            attr_type, attr_len = struct.unpack(">HH", data[offset : offset + 4])
            offset += 4
            if attr_type == 0x0020:  # XOR-MAPPED-ADDRESS
                _, family, x_port, x_ip = struct.unpack(
                    ">BBHI", data[offset : offset + 8]
                )
                port = x_port ^ (0x2112A442 >> 16)
                ip_bin = x_ip ^ 0x2112A442
                ip = socket.inet_ntoa(struct.pack(">I", ip_bin))
                return ip, port, sock
            offset += attr_len
    except Exception as e:
        logger.error(f"STUN Error: {e}")
    return None, None, sock


class MeroHost:
    def __init__(self, local_port=25565, logger_func=None):
        self.local_port = local_port
        self.public_ip = None
        self.public_port = None
        self.udp_sock = None
        # Mapping: (client_addr, conn_id) -> tcp_sock
        self.streams = {}
        self.running = True
        self.invite_code = None
        self.manifest_url = ""
        self.logger_func = logger_func or (lambda msg: logger.info(msg))

    def log(self, msg):
        self.logger_func(f"[Mero Host] {msg}")

    def start(self):
        self.log("🔍 Discovering Public IP/Port via STUN...")
        self.public_ip, self.public_port, self.udp_sock = get_public_ip_port(bind_port=self.local_port)

        if not self.public_ip:
            self.log("❌ Failed to get public info via STUN.")
            return False

        # Invite Code includes IP, UDP Port, and Minecraft Port
        invite_str = f"{self.public_ip}:{self.public_port}:{self.local_port}"
        self.invite_code = base64.b64encode(invite_str.encode()).decode()

        self.log(f"✅ P2P Host Active. Invite Code: {self.invite_code}")

        self.udp_sock.settimeout(1.0)
        threading.Thread(target=self.udp_listener, daemon=True).start()
        return True

    def stop(self):
        self.running = False
        if self.udp_sock:
            try:
                self.udp_sock.close()
            except:
                pass
        for sock in list(self.streams.values()):
            try:
                sock.close()
            except:
                pass
        self.streams.clear()

    def udp_listener(self):
        while self.running:
            try:
                data, addr = self.udp_sock.recvfrom(16384 + 4)
                if not data:
                    continue

                # Protocol: [4 bytes Connection ID] [Data...]
                if len(data) < 4:
                    continue

                conn_id = struct.unpack(">I", data[:4])[0]
                payload = data[4:]

                if conn_id == 0:
                    # Heartbeat/Control
                    if payload == b"STATUS":
                        phase = "running"
                        if hasattr(self, "get_status"):
                            try:
                                phase = self.get_status()
                            except:
                                pass
                        status_dict = {"url": getattr(self, "manifest_url", ""), "status": phase, "name": getattr(self, "server_name", "")}
                        status_msg = struct.pack(">I", 0) + __import__('json').dumps(status_dict).encode()
                        self.udp_sock.sendto(status_msg, addr)
                        continue

                stream_key = (addr, conn_id)

                if payload == b"":  # Close signal
                    self.cleanup_stream(stream_key)
                    continue

                if stream_key not in self.streams:
                    # New virtual connection request
                    self.log(f"⚡ New connection stream {conn_id} from {addr}")
                    threading.Thread(
                        target=self.start_stream_bridge,
                        args=(addr, conn_id),
                        daemon=True,
                    ).start()
                    # Wait a tiny bit for the thread to start and add to streams
                    time.sleep(0.05)

                if stream_key in self.streams:
                    try:
                        self.streams[stream_key].sendall(payload)
                    except:
                        self.cleanup_stream(stream_key)
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    self.log(f"UDP Listener Error: {e}")
                break

    def start_stream_bridge(self, addr, conn_id):
        stream_key = (addr, conn_id)
        try:
            tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tcp_sock.connect(("127.0.0.1", self.local_port))
            self.streams[stream_key] = tcp_sock

            while self.running and stream_key in self.streams:
                data = tcp_sock.recv(16384)
                if not data:
                    break
                # Wrap in protocol
                packet = struct.pack(">I", conn_id) + data
                try:
                    self.udp_sock.sendto(packet, addr)
                except:
                    break
        except Exception as e:
            self.log(f"Stream Bridge Error ({conn_id}): {e}")
        finally:
            self.cleanup_stream(stream_key)
            # Send close signal to client
            try:
                self.udp_sock.sendto(struct.pack(">I", conn_id), addr)
            except:
                pass

    def cleanup_stream(self, stream_key):
        if stream_key in self.streams:
            try:
                self.streams[stream_key].close()
            except:
                pass
            del self.streams[stream_key]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    host = MeroHost()
    if host.start():
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            host.stop()
