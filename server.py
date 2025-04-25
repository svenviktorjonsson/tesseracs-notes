import http.server
import socketserver
import os

# Configuration
PORT = 5432
DIRECTORY = "public"

# Change to the public directory to serve static files
os.chdir(DIRECTORY)

# Set up the HTTP server
Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://127.0.0.1:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.server_close()