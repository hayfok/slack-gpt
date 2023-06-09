# slack-gpt
allows turbo3.5 into slack, complete with message persistance in a mysql database

This is meant to be demonstrative in the event someone wants to take note from a working application

db schemas:


    session -> (RID int AI PK, sessionID mediumtext, userID tinytext, role tinytext, content longtext)
  
  
    users -> (ID int PK, userID tinytext, userName tinytext)
  
  
    tokens -> (tokenCount bigint)
  
