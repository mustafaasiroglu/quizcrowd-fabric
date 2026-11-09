-- Apply after 001-schema.sql. For upgrades: first batch, new Function, second batch.
-- Retains old codes as aliases and keeps existing IDs, credentials and game data.
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRANSACTION;
SELECT Id FROM quizcrowd.Settings WITH (XLOCK,HOLDLOCK) WHERE Id=1;
IF COL_LENGTH(N'quizcrowd.Games', N'LegacyCode') IS NULL
  ALTER TABLE quizcrowd.Games ADD LegacyCode varchar(10) NULL;
COMMIT;
GO
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRANSACTION;
SELECT Id FROM quizcrowd.Settings WITH (XLOCK,HOLDLOCK) WHERE Id=1;
DECLARE @id uniqueidentifier, @old varchar(10), @code varchar(6), @tries int;
DECLARE games CURSOR LOCAL FAST_FORWARD FOR
  SELECT Id,Code FROM quizcrowd.Games WITH (UPDLOCK,HOLDLOCK)
  WHERE LEN(Code)<>6 OR Code LIKE '%[^0-9]%';
OPEN games;
FETCH NEXT FROM games INTO @id,@old;
WHILE @@FETCH_STATUS=0
BEGIN
  SET @tries=0;
  WHILE 1=1
  BEGIN
    SET @code=RIGHT('000000'+CONVERT(varchar(6),CONVERT(bigint,CRYPT_GEN_RANDOM(4))%1000000),6);
    IF NOT EXISTS(SELECT 1 FROM quizcrowd.Games WITH (UPDLOCK,HOLDLOCK) WHERE Code=@code) BREAK;
    SET @tries+=1;
    IF @tries>=32 THROW 51000,'Unable to allocate a unique six-digit game code.',1;
  END;
  UPDATE quizcrowd.Games SET LegacyCode=@old,Code=@code,
    Document=JSON_MODIFY(Document,'$.code',@code) WHERE Id=@id;
  FETCH NEXT FROM games INTO @id,@old;
END;
CLOSE games;
DEALLOCATE games;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'quizcrowd.Games') AND name=N'UX_QuizCrowdLegacyCode')
  CREATE UNIQUE INDEX UX_QuizCrowdLegacyCode ON quizcrowd.Games(LegacyCode) WHERE LegacyCode IS NOT NULL;
IF OBJECT_ID(N'quizcrowd.CK_QuizCrowdNumericCode',N'C') IS NULL
  ALTER TABLE quizcrowd.Games ADD CONSTRAINT CK_QuizCrowdNumericCode CHECK(LEN(Code)=6 AND Code NOT LIKE '%[^0-9]%');
COMMIT;
