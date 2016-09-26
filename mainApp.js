var fejerproApp = angular.module('fejerproApp', ['ui-notification', 'ngDialog', 'ngRoute', 'ngStorage']);
fejerproApp.constant('config', {
    host: 'https://test.fejer.pro',
    defaultLocale: '/en',
    apiUrl: '/backbone',
    endpoint: config.host+config.apiUrl,
});

fejerproApp.config(function($routeProvider) {
  $routeProvider
    .when('/', {
      templateUrl : 'requisitions-list.html',
      controller  : 'RequisitionsListController'
    })
    .when('/complete/:requisitionId', {
      templateUrl : 'complete-requisition.html',
      controller  : 'CompleteRequisitionController'
    }).
    otherwise({
      redirectTo: '/index.html'
    });
});

//Caching the pages so they are available to offline browsing
fejerproApp.run(function($templateCache, $http){
  $templateCache.put('complete-requisition.html', $http.get('offline/angular/views/complete-requisition.html'));
  $templateCache.put('requisitions-list.html', $http.get('offline/angular/views/requisitions-list.html'));
  $templateCache.put('ui-notification.html', $http.get('offline/angular/views/ui-notification.html'));
  $templateCache.put('menu.html', $http.get('offline/angular/views/menu.html'));
  $templateCache.put('requisitions-table.html', $http.get('offline/angular/views/requisitions-table.html'));
  $templateCache.put('property-list.html', $http.get('offline/angular/views/property-list.html'));
  $templateCache.put('delete-from-cache-popup.html', $http.get('offline/angular/views/delete-from-cache-popup.html'));
  $templateCache.put('edit-comment.html', $http.get('offline/angular/views/edit-comment.html'));
});

fejerproApp.factory('ConnectionService', ['$http', 'Notification', '$localStorage', '$window', 'appConfig',  
  function($http, Notification, $localStorage, $window, appConfig) {
  var factory = {};
  var requestQueue = [];
  factory.refreshTimeoutHandle = 0;
  fejerproApp.constant('config', {
    defaultRefreshRate: 5000,
    requisitionsListUrl: appConfig.endpoint + '/requisitionsList/request,ajax/mode,json/filters,year,',
    requisitionDetailsUrl: appConfig.endpoint + '/RequisitionVisitsList/request,ajax/mode,json',
    updateCommentUrl: appConfig.host + appConfig.defaultLocale + '/comments/edit/request,ajax/mode,json',
    deleteCommentUrl: appConfig.host + appConfig.defaultLocale + '/comments/delete/request,ajax/mode,json',
  });

  $localStorage.$default({
    requisitionsCache: [],
    fillingDate: new Date('2010-01-01')
  });

  var wrapFunctionCall = function (fn, context, params) {
    return function() {
        return fn.apply(context, params);
    };
  }

  var popRequestFromQueue = function () {
    if(requestQueue.length > 0)
    {
      (requestQueue.shift())()
      .then(function (data) {
        popRequestFromQueue();
      })
      .catch(function () {
        runAutoConnectionCheck();
      });
    }
  }

  var trySendRequest = function ()
  {
    factory.refreshTimeoutHandle = 0;

    $http.head(appConfig.endpoint)
    .then(function successCallback(response) {
      popRequestFromQueue();
    }, function errorCallback(response) {
      runAutoConnectionCheck();
    })
  }

  var runAutoConnectionCheck = function ()
  {
    if(factory.refreshTimeoutHandle == 0)
      factory.refreshTimeoutHandle = setTimeout(trySendRequest, factory.defaultRefreshRate);
  }

  factory.clearCache = function () {
    $localStorage.$reset({
      requisitionsCache: undefined,
      fillingDate: undefined
    });

    Notification.success('Cache is cleared.');
    setTimeout(function(){$window.location.href = 'index.html'}, 700);
  };

  factory.getRequisitions = function(year, success) {
    var lastUpdate = new Date($localStorage.fillingDate);
    var age = (new Date() - lastUpdate)/1000/60; //Seconds
    var treshhold = 3;

    if($localStorage.requisitionsCache[year]) {
      success($localStorage.requisitionsCache[year]);

      if(age > treshhold)
      {
        Notification.error('The cache is older than ' + treshhold + ' minutes.');
      }
      return;
    }

    $http.get(factory.config.requisitionsListUrl+year).then(function(response) {
      if(response.data.result !== undefined)
      {
        response.data.result.requisitions.forEach(function(item) {
          item.pending = false;
          item.detailsLoaded = false;
        });

        $localStorage.requisitionsCache[year] = response.data;
        $localStorage.fillingDate = new Date();
        success(response.data);
      }
    })
    .catch(function() {
      Notification.error('Network is not available. Please try again later.');
    });
  };

  factory.getRequisitionDetails = function(requisition, success) {
      var dataObj = {'form[requisitionId]' : requisition.id};
      requisition.pending = true;
      $http({
              method: 'POST',
              url: factory.config.requisitionDetailsUrl,
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              transformRequest: function(obj) {
                var str = [];
                for(var p in obj)
                str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
                return str.join("&");
              },
              data: dataObj
            }).then(function(response) {
              requisition.detailsLoaded = true;
              requisition.details = response.data.result;

              for (var i = requisition.details.length - 1; i >= 0; i--) {
                requisition.details[i].propCount = Object.keys(requisition.details[i].items).length;
              };

              success(response.data.result);
            })
            .catch(function(error) {
              Notification.error('Network is not available. Please try again later.');
              requisition.detailsLoaded = false;
            })
            .finally(function() {
              requisition.pending = false;
            });
  };

  factory.getRequisitionDetailsById = function(requisitionId, success) {
    if($localStorage.requisitionsCache && $localStorage.requisitionsCache.length != 0)
    {
      var year = $localStorage.requisitionsCache.filter(year => year && year.result.requisitions.some(item => item.id == requisitionId))[0];
      if(year != undefined)
      {
        var requisition = year.result.requisitions.filter(item => item.id == requisitionId)[0];
        if(requisition.detailsLoaded)
        {
          success(requisition);
          return;
        }

        factory.getRequisitionDetails(requisition, function(data) {
            requisition.details = data;
            success(requisition);
          });
        return;
      }
    }

    //if the record isn't present in cache - fallback to the old API.
    $window.location.href = appConfig.host + '/en/requisitions/complete/node,' + requisitionId;
  };

  factory.updateComment = function(sweeperPropId, comment, success) {
    var commentsUrl = factory.config.updateCommentUrl+'/filters,sweeperPropertyID,'+sweeperPropId+'/node,'+comment.comment_id+'/&param='+Math.round(Math.random()*100000000);

    var dataObj = {
      'action'                  : 'save', 
      'form[category]'          : comment.category,
      'form[text]'              : comment.title,
      'form[inRequisition]'     : comment.show_in_requisitions ? 1 : 0,
      'form[inNextRequisition]' : comment.show_in_next ? 1 : 0,
      'form[inThisReq]'         : comment.this_requisition_only,
      'form[finished]'          : comment.finished ? comment.finished : '',
      'form[deadline]'          : comment.deadline ? comment.deadline : '',
      'form[content]'           : comment.detail,
    };

    return $http({
            method: 'POST',
            url: commentsUrl,
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            transformRequest: function(obj) {
              var str = [];
              for(var p in obj)
              str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
              return str.join("&");
            },
            data: dataObj
          }).then(function(response) {
            success(comment);
          })
          .catch(function(error) {
            Notification.error('Network is not available. Please try again later.');

            var funContainer = wrapFunctionCall(factory.updateComment, this, [sweeperPropId, comment, success]);
            requestQueue.push(funContainer);
            runAutoConnectionCheck();
          });
  }

  factory.deleteComment = function(sweeperPropId, comment, success) {
    var commentsUrl = factory.config.deleteCommentUrl+'/filters,sweeperPropertyID,'+sweeperPropId+'/node,'+comment.comment_id;
    return $http.get(commentsUrl).then(function(response) {
      success(comment);
    })
    .catch(function() {
      Notification.error('Network is not available. Please try again later.');

      var funContainer = wrapFunctionCall(factory.deleteComment, this, [sweeperPropId, comment, success]);
      requestQueue.push(funContainer);
      runAutoConnectionCheck();
    });
  }
  return factory;
}]);

fejerproApp.filter('unique', function () {
  return function (items, filterOn) {
    if (filterOn === false) {
      return items;
    }

    if ((filterOn || angular.isUndefined(filterOn)) && angular.isArray(items)) {
      var hashCheck = {}, newItems = [];

      var extractValueToCompare = function (item) {
        if (angular.isObject(item) && angular.isString(filterOn)) {
          return item[filterOn];
        } else {
          return item;
        }
      };

      angular.forEach(items, function (item) {
        var valueToCheck, isDuplicate = false;

        for (var i = 0; i < newItems.length; i++) {
          if (angular.equals(extractValueToCompare(newItems[i]), extractValueToCompare(item))) {
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          newItems.push(item);
        }

      });
      items = newItems;
    }
  return items;
}});

fejerproApp.directive('networkUrl', ['$window', '$http', 'Notification', function($window, $http, Notification) {
  return function(scope, element, attrs) {
  var checkAvailability = function() {
    $http.head(attrs.networkUrl)
    .then(function successCallback(response) {
      $window.location.href = attrs.networkUrl;
    }, function errorCallback(response) {
      Notification.error({message:'Network is not available. Please try again later.', templateUrl:'ui-notification.html'});
    });
  };
  element.bind('click', checkAvailability);
  }
}]);

fejerproApp.directive('calendar', function () {
  return {
    require: 'ngModel',
    link: function (scope, el, attr, ngModel) {
      $(el).datepicker({
        dateFormat: 'dd/mm/yy',
        onSelect: function (dateText) {
          scope.$apply(function () {
            ngModel.$setViewValue(dateText);
          });
        }
      });
    }
  };
});