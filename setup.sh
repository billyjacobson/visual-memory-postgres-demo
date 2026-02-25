#!/bin/bash

# Configuration Variables
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
INSTANCE_NAME="living-memory-db"
DB_NAME="living_memory"
DB_USER="memory_app"
# Default password for tutorial (instruct users to change this in production!)
DB_PASS="super_secret_password" 

echo "🚀 Starting setup for Living Memory Database in project: $PROJECT_ID"

# 1. Enable necessary Google Cloud APIs
echo "Enabling Cloud SQL Admin API..."
gcloud services enable sqladmin.googleapis.com

# 2. Create Cloud SQL PostgreSQL instance
# We use Enterprise edition, 1 vCPU, 3.75GB RAM, which is great for demos.
echo "Creating Cloud SQL PostgreSQL instance ($INSTANCE_NAME)..."
echo "This step usually takes 5-10 minutes. Grab a coffee! ☕"
gcloud sql instances create $INSTANCE_NAME \
    --database-version=POSTGRES_15 \
    --cpu=1 \
    --memory=3840MB \
    --region=$REGION \
    --root-password=$DB_PASS \
    --edition=ENTERPRISE

# 3. Create the Database
echo "Creating database ($DB_NAME)..."
gcloud sql databases create $DB_NAME --instance=$INSTANCE_NAME

# 4. Create the Application User
echo "Creating database user ($DB_USER)..."
gcloud sql users create $DB_USER --instance=$INSTANCE_NAME --password=$DB_PASS

# 5. Initialize the Schema
echo "Initializing database schema and pgvector extension..."
# Note: For public tutorials, it's often easiest to prompt the user or use Cloud SQL Auth Proxy implicitly here. 
# We'll use the gcloud direct connect command to pipe the SQL into the instance.
gcloud sql connect $INSTANCE_NAME --user=postgres --quiet < schema.sql

echo "✅ Setup Complete!"
echo "Your Cloud SQL instance is ready."
echo "Connection string details (for your app config):"
echo "Host: psql (via Cloud SQL Auth Proxy)"
echo "User: $DB_USER"
echo "Database: $DB_NAME"
