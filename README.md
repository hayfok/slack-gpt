# slack-gpt
allows turbo3.5 into slack, complete with message persistance in a mysql database

!disclaimer: not meant for production use

db schemas:


    session -> (RID int AI PK, sessionID mediumtext, userID tinytext, role tinytext, content longtext)
  
  
    users -> (ID int PK, userID tinytext, userName tinytext)
  
  
    tokens -> (tokenCount bigint)
  
