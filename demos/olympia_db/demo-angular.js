/**
 * @license
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var app = angular.module('myApp', []);

app.service('DbService', function($http) {
  var db = null;
  var initialized = false;


  /**
   * Builds the database schema.
   * @return {!lf.schema.Builder}
   */
  this.buildSchema_ = function() {
    var schemaBuilder = lf.schema.create('olympia', 1);
    schemaBuilder.createTable('Medal').
        addColumn('city', lf.Type.STRING).
        addColumn('color', lf.Type.STRING).
        addColumn('country', lf.Type.STRING).
        addColumn('discipline', lf.Type.STRING).
        addColumn('eventGender', lf.Type.STRING).
        addColumn('event', lf.Type.STRING).
        addColumn('firstName', lf.Type.STRING).
        addColumn('gender', lf.Type.STRING).
        addColumn('lastName', lf.Type.STRING).
        addColumn('sport', lf.Type.STRING).
        addColumn('year', lf.Type.NUMBER).
        addIndex('idx_year', ['year']).
        addIndex('idx_lastName', ['lastName']);
    return schemaBuilder;
  };


  /**
   * Ensures that database is populated with data and initializes the DB
   * connection.
   * @return {!IThenable}
   * @private
   */
  this.init_ = function() {
    return this.buildSchema_().getInstance().then((
        function(database) {
          db = database;
          window.db = database;
          return this.checkForExistingData_();
        }).bind(this)).then((
        function(dataExist) {
          return dataExist ? Promise.resolve() : this.insertData_();
        }).bind(this));
  };


  /**
   * Gets the db connection.
   * @return {!IThenable.<!lf.proc.Database>}
   */
  this.get = function() {
    if (initialized) {
      return Promise.resolve(db);
    }

    return this.init_().then(function() {
      return db;
    });
  };


  /**
   * Checks if any data exists already in the DB.
   * @private
   */
  this.checkForExistingData_ = function() {
    var medal = db.getSchema().table('Medal');
    return db.select().from(medal).exec().then(
        function(rows) {
          return rows.length > 0;
        });
  };


  /**
   * Inserts data to the DB.
   * @return {!IThenable}
   * @private
   */
  this.insertData_ = function() {
    var medal = db.getSchema().table('Medal');
    return $http.get('data/olympic_medalists.json').then(
        function(response) {
          var rows = response.data.map(function(obj) {
            return medal.createRow(obj);
          });
          return db.insert().into(medal).values(rows).exec();
        });
  };

  // Trigger DB initialization.
  this.init_().then(function() {
    initialized = true;
    console.log('DB connection ready.');
  });
});


app.service('ResultsService', function() {
  /** @private {!Array<!Object>} */
  this.results_ = [];

  /** @private {!Array<string>} */
  this.columnNames_ = [];


  /** @return {!Array<!Object>} */
  this.getResults = function() {
    return this.results_;
  };


  /** @param {!Array<!Object>} results */
  this.setResults = function(results) {
    this.columnNames_ = [];

    if (results.length > 0) {
      Object.keys(results[0]).forEach(
          function(columnName) {
            this.columnNames_.push(columnName);
          }, this);
      this.columnNames_.sort();
    }

    this.results_ = results;
  };


  /** @return {!Array<string>} */
  this.getColumnNames = function() {
    return this.columnNames_;
  };
});


app.controller(
    'ResultsController',
    ['$scope', 'ResultsService', function($scope, resultsService) {
      this.getResults = function() {
        return resultsService.getResults();
      };

      this.getColumnNames = function() {
        return resultsService.getColumnNames();
      };
    }]);


/**
 * @typedef {{
 *  cities: !Array<string>,
 *  colors: !Array<string>,
 *  disciplines: !Array<string>,
 *  events: !Array<string>,
 *  genders: !Array<string>,
 *  years: !Array<number>
 * }}
 * @private
 */
var ColumnDomains_;


/**
 * @typedef {{
 *   city: lf.schema.Column,
 *   color: lf.schema.Column,
 *   country: lf.schema.Column,
 *   discipline: lf.schema.Column,
 *   eventGender: lf.schema.Column,
 *   event: lf.schema.Column,
 *   firstName: lf.schema.Column,
 *   gender: lf.schema.Column,
 *   lastName: lf.schema.Column,
 *   sport: lf.schema.Column,
 *   year: lf.schema.Column
 * }}
 * @private
 */
var MedalSchema_;


app.controller(
    'QueryBuilderController',
    ['$scope', '$http', 'DbService', 'ResultsService',
     function($scope, $http, dbService, resultsService) {
       var unboundValue = undefined;

       this.clear = function() {
         // Removing all predicates.
         $scope.citySelection = unboundValue;
         $scope.disciplineSelection = unboundValue;
         $scope.countrySelection = unboundValue;
         $scope.genderSelection = unboundValue;
         $scope.colorSelection = unboundValue;
         $scope.fromYearSelection = unboundValue;
         $scope.toYearSelection = unboundValue;
         $scope.eventSelection = unboundValue;

         // Removing last results, if any.
         resultsService.setResults([]);

         // Clearing SQL query.
         $scope.sqlQuery = '';
       };


       /** @return {!IThenable} */
       this.populateUi_ = function() {
         return $http.get('data/column_domains.json').then(
             (function(response) {
               var domains = /** @type {!ColumnDomains_} */ (
                   response.data);
               this.fromYears = domains.years;
               this.toYears = domains.years;
               this.cities = domains.cities;
               this.disciplines = domains.disciplines;
               this.countries = domains.countries;
               this.genders = domains.genders;
               this.colors = domains.colors;
               this.events = domains.events;
             }).bind(this));
       };

       this.fromYears = [];
       this.toYears = [];
       this.cities = [];
       this.disciplines = [];
       this.events = [];
       this.countries = [];
       this.genders = [];
       this.colors = [];
       this.sqlQuery = '';
       this.populateUi_();


       this.search = function() {
         this.buildQuery_().then(function(query) {
           $scope.sqlQuery = query.toSql();
           return query.exec();
         }).then(function(results) {
           resultsService.setResults(results);
         });
       };


       // Used to execute a query from the dev tools and have the UI update too.
       window.execQuery = (function(query) {
         this.clear();
         $scope.sqlQuery = query.toSql();
         query.exec().then(function(results) {
           resultsService.setResults(results);
           $scope.$apply();
         });
       }).bind(this);

       window.displayResults = (function(results) {
         resultsService.setResults(results);
         $scope.$apply();
       }).bind(this);


       /**
        * @param {!MedalSchema_} medal
        * @return {?lf.Predicate}
        */
       this.getPredicates_ = function(medal) {
         var predicates = [];

         if ($scope.countrySelection != unboundValue) {
           predicates.push(medal.country.eq($scope.countrySelection));
         }

         if ($scope.colorSelection != unboundValue) {
           predicates.push(medal.color.eq($scope.colorSelection));
         }

         if ($scope.citySelection != unboundValue) {
           predicates.push(medal.city.eq($scope.citySelection));
         }

         if ($scope.genderSelection != unboundValue) {
           predicates.push(medal.gender.eq($scope.genderSelection));
         }

         if ($scope.disciplineSelection != unboundValue) {
           predicates.push(medal.discipline.eq($scope.disciplineSelection));
         }

         if ($scope.eventSelection != unboundValue) {
           predicates.push(medal.event.eq($scope.eventSelection));
         }

         if ($scope.fromYearSelection != unboundValue &&
             $scope.toYearSelection != unboundValue) {
           var minYear = Math.min(
               $scope.fromYearSelection, $scope.toYearSelection);
           var maxYear = Math.max(
               $scope.fromYearSelection, $scope.toYearSelection);
           predicates.push(medal.year.between(minYear, maxYear));
         } else if ($scope.fromYearSelection != unboundValue) {
           predicates.push(medal.year.gte($scope.fromYearSelection));
         } else if ($scope.toYearSelection != unboundValue) {
           predicates.push(medal.year.lte($scope.toYearSelection));
         }

         return predicates.length > 0 ?
             lf.op.and.apply(null, predicates) :
             null;
       };


       /** @return {!IThenable<!lf.query.SelectBuilder>} */
       this.buildQuery_ = function() {
         return dbService.get().then((function(db) {
           var medal = db.getSchema().table('Medal');
           var predicates = this.getPredicates_(medal);
           var query = predicates != null ?
               db.select().from(medal).where(predicates) :
               db.select().from(medal);
           return query;
         }).bind(this));
       };

     }]);
