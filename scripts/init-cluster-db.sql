-- Novatio Institutional Canton Multi-Participant Cluster Database Initialization
-- Provisions dedicated storage for domain synchronizer and 4 independent participant nodes

CREATE DATABASE novatio_synchronizer;
CREATE DATABASE novatio_buyer;
CREATE DATABASE novatio_supplier;
CREATE DATABASE novatio_factorer;
CREATE DATABASE novatio_auditor;

GRANT ALL PRIVILEGES ON DATABASE novatio_synchronizer TO canton;
GRANT ALL PRIVILEGES ON DATABASE novatio_buyer TO canton;
GRANT ALL PRIVILEGES ON DATABASE novatio_supplier TO canton;
GRANT ALL PRIVILEGES ON DATABASE novatio_factorer TO canton;
GRANT ALL PRIVILEGES ON DATABASE novatio_auditor TO canton;
