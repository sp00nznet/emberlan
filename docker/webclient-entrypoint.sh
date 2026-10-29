#!/bin/sh
# Emberlan Web Client Entrypoint
# Substitutes environment variables in nginx config

set -e

# Default values
export API_HOST=${API_HOST:-emberlan-server}
export API_PORT=${API_PORT:-3001}

# Substitute environment variables in nginx config
envsubst '${API_HOST} ${API_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start nginx
exec nginx -g 'daemon off;'
