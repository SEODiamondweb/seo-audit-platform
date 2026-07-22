-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "AuditSource" AS ENUM ('SCREAMING_FROG_CLI', 'MANUAL_IMPORT');
CREATE TYPE "AuditStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'EXPORTING', 'IMPORTING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PARSING', 'MAPPED', 'IMPORTED', 'PARTIAL', 'FAILED');
CREATE TYPE "Indexability" AS ENUM ('INDEXABLE', 'NON_INDEXABLE', 'UNKNOWN');
CREATE TYPE "IssueCategory" AS ENUM ('CRAWLABILITY', 'STATUS_CODE', 'REDIRECT', 'CANONICAL', 'METADATA', 'HEADING', 'CONTENT', 'INTERNAL_LINKING', 'IMAGES', 'SITEMAP', 'ROBOTS', 'HREFLANG', 'STRUCTURED_DATA', 'PERFORMANCE', 'SECURITY');
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED', 'WONT_FIX');
CREATE TYPE "Effort" AS ENUM ('TRIVIAL', 'LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');
CREATE TYPE "ReportFormat" AS ENUM ('HTML', 'PDF', 'CSV');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AuditSource" NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB,
    "score" INTEGER,
    "scoreBreakdown" JSONB,
    "totalUrls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Audit_projectId_idx" ON "Audit"("projectId");
CREATE INDEX "Audit_projectId_auditDate_idx" ON "Audit"("projectId", "auditDate");

CREATE TABLE "ScreamingFrogJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "auditId" TEXT,
    "bullJobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "domain" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "errorMessage" TEXT,
    "exportPath" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScreamingFrogJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScreamingFrogJob_auditId_key" ON "ScreamingFrogJob"("auditId");
CREATE INDEX "ScreamingFrogJob_projectId_idx" ON "ScreamingFrogJob"("projectId");
CREATE INDEX "ScreamingFrogJob_status_idx" ON "ScreamingFrogJob"("status");

CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "columnMapping" JSONB,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "unknownColumns" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportedFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportedFile_auditId_key" ON "ImportedFile"("auditId");

CREATE TABLE "CrawledUrl" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT,
    "statusCode" INTEGER,
    "indexability" "Indexability" NOT NULL DEFAULT 'UNKNOWN',
    "indexabilityStatus" TEXT,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "metaDescriptionLength" INTEGER,
    "h1" TEXT,
    "h2" TEXT,
    "canonical" TEXT,
    "metaRobots" TEXT,
    "hreflang" TEXT,
    "wordCount" INTEGER,
    "crawlDepth" INTEGER,
    "inlinks" INTEGER,
    "outlinks" INTEGER,
    "redirectUrl" TEXT,
    "responseTimeMs" INTEGER,
    "images" INTEGER,
    "imagesMissingAlt" INTEGER,
    "structuredData" BOOLEAN,
    "structuredDataTypes" TEXT,
    "inSitemap" BOOLEAN,
    "rawIssues" JSONB,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawledUrl_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrawledUrl_auditId_idx" ON "CrawledUrl"("auditId");
CREATE INDEX "CrawledUrl_auditId_statusCode_idx" ON "CrawledUrl"("auditId", "statusCode");
CREATE INDEX "CrawledUrl_auditId_indexability_idx" ON "CrawledUrl"("auditId", "indexability");
CREATE UNIQUE INDEX "CrawledUrl_auditId_url_key" ON "CrawledUrl"("auditId", "url");

CREATE TABLE "AuditIssue" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "IssueCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "priority" "Priority" NOT NULL,
    "description" TEXT NOT NULL,
    "seoImpact" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "effort" "Effort" NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditIssue_auditId_idx" ON "AuditIssue"("auditId");
CREATE INDEX "AuditIssue_auditId_category_idx" ON "AuditIssue"("auditId", "category");
CREATE INDEX "AuditIssue_auditId_severity_idx" ON "AuditIssue"("auditId", "severity");
CREATE UNIQUE INDEX "AuditIssue_auditId_ruleKey_key" ON "AuditIssue"("auditId", "ruleKey");

CREATE TABLE "AuditIssueUrl" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "urlId" TEXT NOT NULL,
    "evidence" TEXT,
    CONSTRAINT "AuditIssueUrl_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditIssueUrl_issueId_idx" ON "AuditIssueUrl"("issueId");
CREATE INDEX "AuditIssueUrl_urlId_idx" ON "AuditIssueUrl"("urlId");
CREATE UNIQUE INDEX "AuditIssueUrl_issueId_urlId_key" ON "AuditIssueUrl"("issueId", "urlId");

CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'P2',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_issueId_idx" ON "Task"("issueId");

CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "storedPath" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Report_auditId_idx" ON "Report"("auditId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreamingFrogJob" ADD CONSTRAINT "ScreamingFrogJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreamingFrogJob" ADD CONSTRAINT "ScreamingFrogJob_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawledUrl" ADD CONSTRAINT "CrawledUrl_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditIssueUrl" ADD CONSTRAINT "AuditIssueUrl_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AuditIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditIssueUrl" ADD CONSTRAINT "AuditIssueUrl_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "CrawledUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AuditIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
