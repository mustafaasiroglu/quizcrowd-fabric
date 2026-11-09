-- Run once, as a trusted database administrator, in a Fabric SQL DATABASE.
-- Do not use a Warehouse/Lakehouse read-only analytics endpoint.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF SCHEMA_ID(N'quizcrowd') IS NULL EXEC(N'CREATE SCHEMA quizcrowd');
IF OBJECT_ID(N'quizcrowd.Settings') IS NULL
BEGIN
  CREATE TABLE quizcrowd.Settings (
    Id int NOT NULL CONSTRAINT PK_QuizCrowdSettings PRIMARY KEY CHECK (Id = 1),
    AnonymousEnabled bit NOT NULL DEFAULT 0,
    GuestEpoch int NOT NULL DEFAULT 0
  );
  INSERT quizcrowd.Settings (Id, AnonymousEnabled, GuestEpoch) VALUES (1, 0, 0);
END;
IF OBJECT_ID(N'quizcrowd.Administrators') IS NULL
  CREATE TABLE quizcrowd.Administrators (
    Subject nvarchar(255) NOT NULL CONSTRAINT PK_QuizCrowdAdministrators PRIMARY KEY
  );
IF OBJECT_ID(N'quizcrowd.Games') IS NULL
BEGIN
  CREATE TABLE quizcrowd.Games (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_QuizCrowdGames PRIMARY KEY,
    Code varchar(10) NOT NULL CONSTRAINT UQ_QuizCrowdCode UNIQUE,
    LegacyCode varchar(10) NULL,
    OwnerSubject nvarchar(255) NOT NULL,
    Document nvarchar(max) NOT NULL CHECK (ISJSON(Document) = 1)
  );
  CREATE INDEX IX_QuizCrowdOwner ON quizcrowd.Games(OwnerSubject);
END;
IF OBJECT_ID(N'quizcrowd.Audit') IS NULL
  CREATE TABLE quizcrowd.Audit (
    Id bigint IDENTITY NOT NULL CONSTRAINT PK_QuizCrowdAudit PRIMARY KEY,
    ChangedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Actor nvarchar(255) NOT NULL,
    AnonymousEnabled bit NOT NULL,
    GuestEpoch int NOT NULL
  );
COMMIT;

-- Grant the Fabric App ITEM OWNER identity access to this database separately.
-- Substitute a trusted contained database principal; never grant these to attendees.
-- GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::quizcrowd TO [app-owner-principal];
-- See docs/deployment.md for bootstrap and least-privilege caveats.
